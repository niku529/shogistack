import React, { useState, useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import ShogiBoard from './components/ShogiBoard';
import Komadai from './components/Komadai';
import Chat from './components/Chat';
import { BoardState, Coordinates, Hand, Move, PieceType, Player } from './types';
import { createInitialBoard, isValidMove, applyMove, exportKIF } from './utils/shogiUtils';
import { SENTE_PROMOTION_ZONE, GOTE_PROMOTION_ZONE } from './constants';

const EMPTY_HAND = {
  [PieceType.Pawn]: 0, [PieceType.Lance]: 0, [PieceType.Knight]: 0, [PieceType.Silver]: 0,
  [PieceType.Gold]: 0, [PieceType.Bishop]: 0, [PieceType.Rook]: 0, [PieceType.King]: 0,
  [PieceType.PromotedPawn]: 0, [PieceType.PromotedLance]: 0, [PieceType.PromotedKnight]: 0,
  [PieceType.PromotedSilver]: 0, [PieceType.Horse]: 0, [PieceType.Dragon]: 0,
};

// 環境変数からバックエンドのURLを取得（なければローカル）
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const socket: Socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: false,
});

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
const bufferSize = audioCtx.sampleRate * 2.0;
const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
const output = noiseBuffer.getChannelData(0);
for (let i = 0; i < bufferSize; i++) {
  output[i] = Math.random() * 2 - 1;
}

const playSound = (type: 'move' | 'alert' | 'timeout') => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  if (type === 'move') {
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(8000, now); 

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.015); 

    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now); 
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.15, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.connect(oscGain);
    oscGain.connect(audioCtx.destination);

    noise.start(now);
    noise.stop(now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);

  } else if (type === 'alert') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(1000, now);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);

  } else if (type === 'timeout') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(100, now + 1.0);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 1.0);
    osc.start(now);
    osc.stop(now + 1.0);
  }
};

type GameStatus = 'waiting' | 'playing' | 'finished' | 'analysis';
type Role = 'sente' | 'gote' | 'audience';

interface TimeSettings {
  initial: number;
  byoyomi: number;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const isSameMove = (a: Move, b: Move) => {
  const fromA = typeof a.from === 'string' ? a.from : `${a.from.x},${a.from.y}`;
  const fromB = typeof b.from === 'string' ? b.from : `${b.from.x},${b.from.y}`;
  return fromA === fromB &&
         a.to.x === b.to.x && a.to.y === b.to.y &&
         a.piece === b.piece && a.drop === b.drop && !!a.isPromoted === !!b.isPromoted;
};

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [isAnalysisRoom, setIsAnalysisRoom] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myRole, setMyRole] = useState<Role>('audience');
  const [readyStatus, setReadyStatus] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [rematchRequests, setRematchRequests] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [isFlipped, setIsFlipped] = useState(false);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [winner, setWinner] = useState<Player | null>(null);
  const [initialBoard] = useState<BoardState>(createInitialBoard());
  const [settings, setSettings] = useState<TimeSettings>({ initial: 600, byoyomi: 30 });
  const [times, setTimes] = useState<{sente: number, gote: number}>({sente: 600, gote: 600});
  const [byoyomi, setByoyomi] = useState<{sente: number, gote: number}>({sente: 30, gote: 30});
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [displayBoard, setDisplayBoard] = useState<BoardState>(createInitialBoard());
  const [displayHands, setDisplayHands] = useState<{ sente: Hand; gote: Hand }>({
    sente: { ...EMPTY_HAND }, gote: { ...EMPTY_HAND },
  });
  const [displayTurn, setDisplayTurn] = useState<Player>('sente'); 
  const [displayLastMove, setDisplayLastMove] = useState<{ from: Coordinates | 'hand'; to: Coordinates } | null>(null);
  const [history, setHistory] = useState<Move[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(0); 
  const [selectedSquare, setSelectedSquare] = useState<Coordinates | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<PieceType | null>(null);
  const [promotionCandidate, setPromotionCandidate] = useState<{ move: Move } | null>(null);

  const [isLocalMode, setIsLocalMode] = useState(false);
  const isLocalModeRef = useRef(false);

  const isProcessingMove = useRef(false);

  useEffect(() => {
    let storedId = localStorage.getItem('shogi_user_id');
    if (!storedId) {
      storedId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('shogi_user_id', storedId);
    }
    setUserId(storedId);
  }, []);

  const updateDisplay = useCallback((moves: Move[], index: number) => {
    let currentBoard = createInitialBoard();
    let currentHands = { sente: { ...EMPTY_HAND }, gote: { ...EMPTY_HAND } };
    let currentTurn: Player = 'sente';
    let lastM = null;

    try {
      for (let i = 0; i < index; i++) {
        const m = moves[i];
        if (!m) break;
        const res = applyMove(currentBoard, currentHands, m, currentTurn);
        currentBoard = res.board;
        currentHands = res.hands;
        currentTurn = res.turn as Player;
        lastM = { from: m.from, to: m.to };
      }
    } catch (e) {
      console.error("Error applying move history:", e);
    }

    setDisplayBoard(currentBoard);
    setDisplayHands(currentHands);
    setDisplayTurn(currentTurn);
    setDisplayLastMove(lastM);
  }, []);

  useEffect(() => {
    updateDisplay(history, viewIndex);
  }, [history, viewIndex, updateDisplay]);

  useEffect(() => {
    if (gameStatus === 'playing') {
      setIsFlipped(myRole === 'gote');
    }
  }, [gameStatus, myRole]);

  useEffect(() => {
    if (gameStatus !== 'playing') return;
    const currentP = displayTurn; 
    const isByoyomi = times[currentP] === 0;
    const val = isByoyomi ? byoyomi[currentP] : times[currentP];
    if (isByoyomi && val <= 10 && val > 0) {
      playSound('alert');
    }
  }, [times, byoyomi, gameStatus, displayTurn]);

  const toggleLocalMode = () => {
    if (isLocalMode) {
      if (window.confirm("ローカル検討を終了し、最新の同期局面に戻りますか？")) {
        setIsLocalMode(false);
        isLocalModeRef.current = false;
        socket.emit("join_room", { roomId, mode: isAnalysisRoom ? 'analysis' : 'normal', userId });
      }
    } else {
      setIsLocalMode(true);
      isLocalModeRef.current = true;
    }
  };

  useEffect(() => {
    if (!joined || !userId) return;

    socket.connect();
    socket.emit("join_room", { roomId, mode: isAnalysisRoom ? 'analysis' : 'normal', userId });

    socket.on("sync", (data: any) => {
      isProcessingMove.current = false;
      setHistory(data.history);
      setGameStatus(data.status);
      setWinner(data.winner as Player | null);
      setReadyStatus(data.ready || {sente: false, gote: false});
      setRematchRequests(data.rematchRequests || {sente: false, gote: false});
      setViewIndex(data.history.length);
      if (data.settings) setSettings(data.settings);
      if (data.times) setTimes(data.times);
      if (data.yourRole) setMyRole(data.yourRole as Role);
    });

    socket.on("settings_updated", (newSettings: TimeSettings) => setSettings(newSettings));
    socket.on("ready_status", (ready: {sente: boolean, gote: boolean}) => setReadyStatus(ready));
    socket.on("rematch_status", (req: {sente: boolean, gote: boolean}) => setRematchRequests(req));
    socket.on("time_update", (data: { times: any, currentByoyomi: any }) => {
      setTimes(data.times);
      setByoyomi(data.currentByoyomi);
    });

    socket.on("game_started", () => {
      isProcessingMove.current = false;
      setIsLocalMode(false);
      isLocalModeRef.current = false;
      
      setHistory([]);
      setGameStatus('playing');
      setWinner(null);
      setRematchRequests({sente: false, gote: false});
      setViewIndex(0);
      playSound('alert');
      alert("対局開始！お願いします。");
    });

    socket.on("game_finished", (data: { winner: Player | null, reason?: string }) => {
      isProcessingMove.current = false;
      setGameStatus('finished');
      setWinner(data.winner);
      playSound('timeout');
      
      let msg = "終局！";
      if (data.reason === 'illegal_sennichite') {
         msg += ` ${data.winner === 'sente' ? '先手' : '後手'}の勝ち (連続王手の千日手)`;
      } else if (data.reason === 'sennichite') {
         msg += " 千日手が成立しました（引き分け）";
      } else if (data.reason === 'timeout') {
         msg += ` ${data.winner === 'sente' ? '先手' : '後手'}の勝ち (時間切れ)`;
      } else {
         msg += ` ${data.winner === 'sente' ? '先手' : '後手'}の勝ち`;
      }
      alert(msg);
    });

    socket.on("move", (move: Move) => {
      if (isLocalModeRef.current) return;

      isProcessingMove.current = false;

      setHistory(prev => {
        const last = prev[prev.length - 1];
        if (last && isSameMove(last, move)) {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1] = move;
          return newHistory;
        }
        
        playSound('move');
        const newHistory = [...prev, move];
        setViewIndex(newHistory.length); 
        return newHistory;
      });
    });

    socket.on("receive_message", (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.off("sync");
      socket.off("settings_updated");
      socket.off("ready_status");
      socket.off("rematch_status");
      socket.off("time_update");
      socket.off("game_started");
      socket.off("game_finished");
      socket.off("move");
      socket.off("receive_message");
      socket.disconnect();
    };
  }, [joined, roomId, userId]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) setJoined(true);
  };
  const updateSettings = (key: keyof TimeSettings, value: number) => {
    const newSettings = { ...settings, [key]: value };
    socket.emit("update_settings", { roomId, settings: newSettings });
  };
  const toggleReady = () => {
    if (myRole === 'sente' || myRole === 'gote') socket.emit("toggle_ready", { roomId, role: myRole });
  };
  const resignGame = (loser: Player) => {
    if(window.confirm("本当に投了しますか？")) socket.emit("game_resign", { roomId, loser });
  };

  const processMove = (move: Move) => {
    if (gameStatus === 'playing') {
      if (myRole !== 'sente' && myRole !== 'gote') return;
      if (myRole !== displayTurn) return;
      if (viewIndex !== history.length) {
        alert("最新の局面に戻ってください");
        return;
      }
    }

    if (isProcessingMove.current) return;
    
    if (isLocalMode) {
       setHistory(prev => {
          const truncated = prev.slice(0, viewIndex);
          return [...truncated, move];
       });
       setViewIndex(viewIndex + 1);
       playSound('move');
       return;
    }

    isProcessingMove.current = true;

    if (gameStatus === 'finished' || gameStatus === 'analysis') {
       socket.emit("move", { roomId, move, branchIndex: viewIndex });
    } else {
       socket.emit("move", { roomId, move });
    }
    
    if ((gameStatus === 'finished' || gameStatus === 'analysis') && viewIndex < history.length) {
       setHistory(prev => {
          const truncated = prev.slice(0, viewIndex);
          return [...truncated, move];
       });
    } else {
       setHistory(prev => [...prev, move]);
    }
    setViewIndex(viewIndex + 1);
    playSound('move');
  };

  const requestUndo = () => {
    if (isLocalMode) {
       if (viewIndex > 0) {
          setViewIndex(viewIndex - 1);
       }
       return;
    }

    if (gameStatus === 'finished' || gameStatus === 'analysis') {
       if (history.length === 0) return;
       if(window.confirm("局面を1手戻しますか？（全員に反映されます）")) socket.emit("undo", roomId);
       return;
    }

    if (gameStatus === 'playing') return;
    if (history.length === 0) return;
    if(window.confirm("1手戻しますか？")) socket.emit("undo", roomId);
  };

  const requestReset = () => {
    if(window.confirm("初期化しますか？")) socket.emit("reset", roomId);
  };
  const requestRematch = () => {
    if (myRole === 'sente' || myRole === 'gote') socket.emit("rematch", { roomId, role: myRole });
    else alert("観戦者は提案できません");
  };
  const copyKIF = () => {
    const kif = exportKIF(history, initialBoard);
    navigator.clipboard.writeText(kif).then(() => alert("KIFをコピーしました"));
  };
  const handleSendMessage = (text: string) => {
    socket.emit("send_message", { roomId, message: text, role: myRole });
  };

  const handleSquareClick = (coords: Coordinates) => {
    if (gameStatus === 'waiting') return;
    
    const clickedPiece = displayBoard[coords.y][coords.x];
    if (clickedPiece?.owner === displayTurn) {
      setSelectedSquare(coords);
      setSelectedHandPiece(null);
      return;
    }
    if (selectedSquare) {
      const piece = displayBoard[selectedSquare.y][selectedSquare.x];
      if (!piece) return;
      
      let mustPromote = false;
      if (displayTurn === 'sente') {
        if ((piece.type === PieceType.Pawn || piece.type === PieceType.Lance) && coords.y === 0) mustPromote = true;
        if (piece.type === PieceType.Knight && coords.y <= 1) mustPromote = true;
      } else {
        if ((piece.type === PieceType.Pawn || piece.type === PieceType.Lance) && coords.y === 8) mustPromote = true;
        if (piece.type === PieceType.Knight && coords.y >= 7) mustPromote = true;
      }

      const baseMove: Move = { 
        from: selectedSquare, 
        to: coords, 
        piece: piece.type, 
        drop: false, 
        isPromoted: mustPromote ? true : false 
      };
      
      if (!isValidMove(displayBoard, displayTurn, baseMove)) return; 

      const isEnteringZone = (displayTurn === 'sente' ? SENTE_PROMOTION_ZONE : GOTE_PROMOTION_ZONE).includes(coords.y);
      const isLeavingZone = (displayTurn === 'sente' ? SENTE_PROMOTION_ZONE : GOTE_PROMOTION_ZONE).includes(selectedSquare.y);
      const canPromote = !piece.isPromoted && (isEnteringZone || isLeavingZone) && 
                         piece.type !== PieceType.Gold && piece.type !== PieceType.King;

      if (mustPromote) {
        processMove({ ...baseMove, isPromoted: true });
        setSelectedSquare(null);
        return;
      }
      if (canPromote) {
        setPromotionCandidate({ move: { ...baseMove, isPromoted: false } });
        setSelectedSquare(null);
        return;
      }
      
      processMove(baseMove);
      setSelectedSquare(null);
      return;
    }
    if (selectedHandPiece) {
      if (clickedPiece === null) {
        const move: Move = { 
          from: 'hand', 
          to: coords, 
          piece: selectedHandPiece, 
          drop: true,
          isPromoted: false 
        };
        if (isValidMove(displayBoard, displayTurn, move)) {
          processMove(move);
        }
        setSelectedHandPiece(null);
      }
    }
  };

  const handleHandPieceClick = (piece: PieceType, owner: Player) => {
    if (gameStatus === 'waiting') return;
    if (owner !== displayTurn) return;
    setSelectedHandPiece(piece);
    setSelectedSquare(null);
  };

  const handlePromotionChoice = (promote: boolean) => {
    if (!promotionCandidate) return;
    processMove({ ...promotionCandidate.move, isPromoted: promote });
    setPromotionCandidate(null);
  };

  const renderTimer = (owner: Player) => {
    const isTurn = displayTurn === owner && gameStatus === 'playing';
    const time = times[owner];
    const byo = byoyomi[owner];
    const inByoyomi = time === 0;
    return (
      <div className={`
        flex flex-col items-end px-3 py-1 rounded border-b-4 transition-colors min-w-[80px]
        ${isTurn ? 'bg-stone-800 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-stone-900 border-stone-800 opacity-60'}
      `}>
        <span className="text-[12px] text-stone-400 font-bold tracking-wider mb-1">
          {owner === 'sente' ? '☗ 先手' : '☖ 後手'}
        </span>
        <div className="flex items-baseline gap-1">
           <span className={`font-mono text-xl ${inByoyomi ? 'text-red-400' : 'text-stone-200'}`}>
             {formatTime(time)}
           </span>
           <span className={`font-mono text-sm ${inByoyomi && isTurn ? 'text-red-500 font-bold animate-pulse' : 'text-stone-500'}`}>
             {inByoyomi ? byo : settings.byoyomi}
           </span>
        </div>
      </div>
    );
  };

  if (!joined) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <form onSubmit={handleJoin} className="bg-stone-800 p-8 rounded-lg shadow-xl border border-amber-700/30 max-w-sm w-full space-y-4">
          <h1 className="text-2xl font-bold text-amber-100 text-center font-serif">Shogistack</h1>
          <div>
            <label className="block text-stone-400 text-sm mb-2">ルーム名</label>
            <input 
              type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)}
              className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-white"
              placeholder="room1"
            />
          </div>
          <div className="flex items-center gap-3 p-3 bg-stone-900/50 rounded border border-stone-700">
             <input type="checkbox" id="analysisMode" checked={isAnalysisRoom} onChange={(e) => setIsAnalysisRoom(e.target.checked)} className="w-5 h-5 accent-amber-600" />
             <label htmlFor="analysisMode" className="text-stone-300 text-sm cursor-pointer">検討室モード</label>
          </div>
          <button type="submit" className="w-full bg-amber-700 hover:bg-amber-600 text-white font-bold py-3 rounded">入室する</button>
        </form>
      </div>
    );
  }

  const BottomHand = isFlipped ? displayHands.gote : displayHands.sente;
  const BottomOwner = isFlipped ? 'gote' : 'sente';
  const TopHand = isFlipped ? displayHands.sente : displayHands.gote;
  const TopOwner = isFlipped ? 'sente' : 'gote';
  const getRoleName = (r: Role) => r === 'sente' ? '先手' : r === 'gote' ? '後手' : '観戦';

  return (
    // ★修正: touch-noneを削除し、レイアウト調整
    <div className="min-h-screen bg-stone-950 flex flex-col lg:flex-row items-center justify-start lg:justify-center p-2 gap-4 relative">
      <div className="flex flex-col items-center w-full max-w-lg shrink-0">
        
        {/* Header Info */}
        <div className="w-full max-w-lg flex justify-between items-start text-stone-400 text-sm px-1 mb-1">
          <div className="flex flex-col gap-1">
            <div>Room: <span className="text-amber-200 font-mono">{roomId}</span></div>
            <div className="text-xs text-stone-500">
               あなた: <span className="font-bold text-stone-300 text-base">{getRoleName(myRole)}</span>
            </div>
          </div>
          <div className={`px-3 py-1 rounded text-xs font-bold border
              ${gameStatus === 'playing' ? 'bg-green-900 text-green-100 border-green-700' : 
                gameStatus === 'waiting' ? 'bg-blue-900 text-blue-100 border-blue-700' :
                'bg-stone-700 text-stone-300 border-stone-600'}
          `}>
            {gameStatus === 'playing' ? "対局中" : gameStatus === 'waiting' ? "対局待ち" : gameStatus === 'analysis' ? "検討中" : "感想戦"}
          </div>
        </div>

        {/* --- Top Area --- */}
        <div className="w-full max-w-lg flex items-end justify-between mb-1 gap-2">
          <div className="flex-1 min-w-0">
             <Komadai hand={TopHand} owner={TopOwner} isCurrentTurn={displayTurn === TopOwner} onSelectPiece={(p) => handleHandPieceClick(p, TopOwner)} selectedPiece={displayTurn === TopOwner ? selectedHandPiece : null} />
          </div>
          <div>{renderTimer(TopOwner)}</div>
        </div>

        {/* --- Board --- */}
        <div className="w-full max-w-lg relative" style={{ transition: 'transform 0.5s', transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
          <ShogiBoard 
            board={displayBoard} onSquareClick={handleSquareClick} selectedSquare={selectedSquare} validMoves={[]} lastMove={displayLastMove} turn={displayTurn}
          />
          {promotionCandidate && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" style={{ transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
              <div className="pointer-events-auto bg-stone-800/95 p-3 rounded-lg border border-amber-500 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex gap-4 animate-in fade-in zoom-in duration-100">
                <button onClick={() => handlePromotionChoice(true)} className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-6 rounded shadow active:scale-95 transition-all text-sm whitespace-nowrap">成る</button>
                <button onClick={() => handlePromotionChoice(false)} className="bg-stone-600 hover:bg-stone-500 text-stone-200 font-bold py-2 px-6 rounded shadow active:scale-95 transition-all text-sm whitespace-nowrap">成らず</button>
              </div>
            </div>
          )}
          {gameStatus === 'waiting' && (
             <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 backdrop-blur-[2px]" style={{ transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
               <div className="bg-stone-900/95 p-6 rounded-xl border border-amber-600 shadow-2xl text-center w-72">
                 <h2 className="text-amber-100 font-bold text-xl mb-4">対局設定</h2>
                 <div className="mb-6 space-y-4 text-left">
                    <div>
                      <label className="text-xs text-stone-400 flex justify-between"><span>持ち時間</span><span className="text-amber-400 font-mono">{Math.floor(settings.initial/60)}分</span></label>
                      <input type="range" min="0" max="3600" step="60" value={settings.initial} onChange={(e) => updateSettings('initial', Number(e.target.value))} className="w-full accent-amber-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"/>
                    </div>
                    <div>
                      <label className="text-xs text-stone-400 flex justify-between"><span>秒読み</span><span className="text-amber-400 font-mono">{settings.byoyomi}秒</span></label>
                      <input type="range" min="0" max="60" step="10" value={settings.byoyomi} onChange={(e) => updateSettings('byoyomi', Number(e.target.value))} className="w-full accent-amber-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"/>
                    </div>
                 </div>
                 {(myRole === 'sente' || myRole === 'gote') ? (
                   <div className="flex flex-col gap-3">
                     <button onClick={toggleReady} className={`font-bold py-3 px-6 rounded-full shadow-lg transition-all active:scale-95 ${readyStatus[myRole] ? 'bg-green-600 text-white hover:bg-green-500 ring-2 ring-green-400' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'}`}>{readyStatus[myRole] ? "準備完了！" : "準備完了"}</button>
                     <div className="text-xs text-stone-400 mt-2"><div>相手: <span className={readyStatus[myRole === 'sente' ? 'gote' : 'sente'] ? 'text-green-400 font-bold' : 'text-stone-500'}>{readyStatus[myRole === 'sente' ? 'gote' : 'sente'] ? "OK" : "..."}</span></div></div>
                   </div>
                 ) : ( <div className="text-stone-400 text-sm">設定中...</div> )}
               </div>
             </div>
          )}
        </div>

        {/* --- Bottom Area --- */}
        <div className="w-full max-w-lg flex items-start justify-between mt-1 gap-2">
          <div className="flex-1 min-w-0">
             <Komadai hand={BottomHand} owner={BottomOwner} isCurrentTurn={displayTurn === BottomOwner} onSelectPiece={(p) => handleHandPieceClick(p, BottomOwner)} selectedPiece={displayTurn === BottomOwner ? selectedHandPiece : null} />
          </div>
          <div>{renderTimer(BottomOwner)}</div>
        </div>

        {/* --- Footer (Controls) --- */}
        <div className="w-full max-w-lg flex flex-col gap-2 mt-2">
          {gameStatus !== 'playing' ? (
            <div className="flex flex-col gap-2 bg-stone-900/50 p-2 rounded border border-stone-800">
              {/* コントロール列 */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2 items-center">
                  <div className="text-stone-400 text-xs font-mono">{viewIndex}手目</div>
                  <button onClick={() => setIsFlipped(!isFlipped)} className="bg-stone-700 text-stone-300 px-2 py-0.5 rounded text-[10px]">反転</button>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setViewIndex(Math.max(0, viewIndex - 1))} className="bg-stone-700 text-stone-200 px-3 py-1 rounded text-xs">◀</button>
                  <button onClick={() => setViewIndex(Math.min(history.length, viewIndex + 1))} className="bg-stone-700 text-stone-200 px-3 py-1 rounded text-xs">▶</button>
                </div>
              </div>
              
              {(gameStatus === 'finished' || gameStatus === 'analysis') && (
                <button 
                  onClick={toggleLocalMode}
                  className={`w-full py-2 rounded text-xs font-bold transition-all shadow-md
                    ${isLocalMode 
                      ? 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white hover:from-blue-600 hover:to-indigo-600 border border-blue-500' 
                      : 'bg-stone-700 text-stone-300 hover:bg-stone-600 border border-stone-600'}
                  `}
                >
                  {isLocalMode ? "同期に戻る" : "ローカル検討"}
                </button>
              )}
            </div>
          ) : ( 
            <div className="flex justify-center p-1 text-stone-600 text-xs font-mono">{viewIndex}手目</div> 
          )}

          <div className="flex justify-between items-center px-1">
             <button onClick={copyKIF} className="text-stone-500 hover:text-white text-xs underline">KIFコピー</button>
             <div className="flex gap-2">
               {gameStatus === 'playing' && (myRole === 'sente' || myRole === 'gote') && (
                  <button onClick={() => resignGame(myRole)} className="bg-stone-800 text-stone-400 border border-stone-600 px-4 py-2 rounded text-xs hover:bg-stone-700 hover:text-white">投了する</button>
               )}
               {(gameStatus === 'finished' || gameStatus === 'analysis') && (
                 <>
                   <button onClick={requestUndo} className="bg-stone-700 text-stone-300 px-3 py-1 rounded text-xs hover:bg-stone-600">1手戻す</button>
                   {(myRole === 'sente' || myRole === 'gote') && (
                     <div className="flex flex-col items-center relative">
                       <button onClick={requestRematch} className={`px-3 py-1 rounded text-xs shadow font-bold transition-colors ${rematchRequests[myRole] ? 'bg-amber-800 text-stone-400' : 'bg-amber-700 text-white hover:bg-amber-600'}`} disabled={rematchRequests[myRole]}>{rematchRequests[myRole] ? "相手待ち..." : "再対局"}</button>
                       {rematchRequests[myRole === 'sente' ? 'gote' : 'sente'] && (<span className="text-[10px] text-green-400 absolute -top-4 w-full text-center animate-bounce font-bold">相手OK!</span>)}
                     </div>
                   )}
                   {myRole === 'audience' && <div className="text-[10px] text-stone-500">再対局待ち...</div>}
                   <button onClick={requestReset} className="bg-red-900/30 text-red-300 px-3 py-1 rounded text-xs hover:bg-red-900/50">リセット</button>
                 </>
               )}
             </div>
          </div>
        </div>
      </div>

      {/* --- 右側 (チャットエリア) --- */}
      <div className="w-full max-w-lg lg:max-w-xs h-[400px] lg:h-[600px] shrink-0">
        <Chat messages={chatMessages} onSendMessage={handleSendMessage} myRole={myRole} />
      </div>

    </div>
  );
};
export default App;