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

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const socket: Socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'], 
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
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
  randomTurn: boolean;
  fixTurn: boolean;
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
  const [userName, setUserName] = useState<string>("");
  const [isAnalysisRoom, setIsAnalysisRoom] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myRole, setMyRole] = useState<Role>('audience');
  const [playerNames, setPlayerNames] = useState<{sente: string | null, gote: string | null}>({sente: null, gote: null});
  const [connectionStatus, setConnectionStatus] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [userCounts, setUserCounts] = useState<{global: number, room: number}>({ global: 0, room: 0 });
  const [readyStatus, setReadyStatus] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [rematchRequests, setRematchRequests] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [isFlipped, setIsFlipped] = useState(false);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [winner, setWinner] = useState<Player | null>(null);
  const [initialBoard] = useState<BoardState>(createInitialBoard());
  const [settings, setSettings] = useState<TimeSettings>({ initial: 600, byoyomi: 30, randomTurn: false, fixTurn: false });
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
  const lastServerTimeData = useRef<{ times: {sente: number, gote: number}, byoyomi: {sente: number, gote: number}, receivedAt: number } | null>(null);
  const lastSoundTime = useRef<number | null>(null);
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

  // ★修正: 役割が決まったら（後手なら）自動反転
  useEffect(() => {
    if (myRole === 'gote') {
      setIsFlipped(true);
    } else if (myRole === 'sente') {
      setIsFlipped(false);
    }
  }, [myRole]);

  useEffect(() => {
    if (gameStatus !== 'playing') return;
    const interval = setInterval(() => {
      if (!lastServerTimeData.current) return;
      const now = Date.now();
      const elapsedSec = (now - lastServerTimeData.current.receivedAt) / 1000;
      const serverTimes = lastServerTimeData.current.times;
      const serverByoyomi = lastServerTimeData.current.byoyomi;
      const currentPlayer = displayTurn;
      let newTime = serverTimes[currentPlayer];
      let newByoyomi = serverByoyomi[currentPlayer];
      if (newTime > 0) {
        newTime = Math.max(0, Math.ceil(serverTimes[currentPlayer] - elapsedSec));
      } else {
        if (newByoyomi > 0) {
           newByoyomi = Math.max(0, Math.ceil(serverByoyomi[currentPlayer] - elapsedSec));
        }
      }
      setTimes(prev => ({
        ...prev,
        [currentPlayer]: newTime,
        [currentPlayer === 'sente' ? 'gote' : 'sente']: serverTimes[currentPlayer === 'sente' ? 'gote' : 'sente']
      }));
      setByoyomi(prev => ({
        ...prev,
        [currentPlayer]: newByoyomi,
        [currentPlayer === 'sente' ? 'gote' : 'sente']: serverByoyomi[currentPlayer === 'sente' ? 'gote' : 'sente']
      }));
    }, 100); 
    return () => clearInterval(interval);
  }, [gameStatus, displayTurn]);

  useEffect(() => {
    if (gameStatus !== 'playing') {
        lastSoundTime.current = null;
        return;
    }
    const currentP = displayTurn; 
    const isByoyomi = times[currentP] === 0;
    const val = isByoyomi ? byoyomi[currentP] : times[currentP];
    if (isByoyomi && val <= 10 && val > 0) {
      if (lastSoundTime.current !== val) {
        playSound('alert');
        lastSoundTime.current = val;
      }
    } else {
        lastSoundTime.current = null;
    }
  }, [times, byoyomi, gameStatus, displayTurn]);

  const toggleLocalMode = () => {
    if (isLocalMode) {
      if (window.confirm("ローカル検討を終了し、最新の同期局面に戻りますか？")) {
        setIsLocalMode(false);
        isLocalModeRef.current = false;
        socket.emit("join_room", { roomId, mode: isAnalysisRoom ? 'analysis' : 'normal', userId, userName });
      }
    } else {
      setIsLocalMode(true);
      isLocalModeRef.current = true;
    }
  };

  useEffect(() => {
    if (!userId) return;

    socket.connect();
    
    const handleConnect = () => {
        if (joined) {
            socket.emit("join_room", { 
                roomId, 
                mode: isAnalysisRoom ? 'analysis' : 'normal', 
                userId, 
                userName: userName.trim() || "名無し" 
            });
        }
    };

    socket.on("connect", handleConnect);
    socket.on("update_global_count", (count: number) => setUserCounts(prev => ({ ...prev, global: count })));

    if (joined) {
        socket.emit("join_room", { 
            roomId, 
            mode: isAnalysisRoom ? 'analysis' : 'normal', 
            userId, 
            userName: userName.trim() || "名無し" 
        });

        socket.on("sync", (data: any) => {
          isProcessingMove.current = false;
          setHistory(data.history);
          setGameStatus(data.status);
          setWinner(data.winner as Player | null);
          setReadyStatus(data.ready || {sente: false, gote: false});
          setRematchRequests(data.rematchRequests || {sente: false, gote: false});
          setViewIndex(data.history.length);
          if (data.settings) setSettings(data.settings);
          if (data.times) {
             setTimes(data.times);
             lastServerTimeData.current = { times: data.times, byoyomi: {sente:30, gote:30}, receivedAt: Date.now() };
          }
          if (data.yourRole) setMyRole(data.yourRole as Role);
          if (data.playerNames) setPlayerNames(data.playerNames);
        });

        socket.on("player_names_updated", (names: {sente: string | null, gote: string | null}) => {
            setPlayerNames(names);
        });

        socket.on("settings_updated", (newSettings: TimeSettings) => setSettings(newSettings));
        socket.on("ready_status", (ready: {sente: boolean, gote: boolean}) => setReadyStatus(ready));
        socket.on("rematch_status", (req: {sente: boolean, gote: boolean}) => setRematchRequests(req));
        
        socket.on("time_update", (data: { times: any, currentByoyomi: any }) => {
          lastServerTimeData.current = {
            times: data.times,
            byoyomi: data.currentByoyomi,
            receivedAt: Date.now()
          };
        });

        socket.on("update_room_count", (count: number) => setUserCounts(prev => ({ ...prev, room: count })));
        
        socket.on("connection_status_update", (status: {sente: boolean, gote: boolean}) => {
            setConnectionStatus(status);
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
          lastServerTimeData.current = null; 
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
    }

    const addSystemMessage = (text: string) => {
        setChatMessages(prev => [...prev, {
            id: Math.random().toString(),
            text: `[DEBUG] ${text}`,
            role: 'system',
            timestamp: Date.now()
        }]);
    };

    socket.on("connect_error", (err) => addSystemMessage(`接続エラー: ${err.message}`));
    socket.on("disconnect", (reason) => addSystemMessage(`切断されました: ${reason}`));
    socket.on("reconnect_attempt", () => addSystemMessage("再接続を試みています..."));
    socket.on("reconnect", () => addSystemMessage("再接続しました"));

    return () => {
      socket.off("connect", handleConnect);
      socket.off("sync");
      socket.off("player_names_updated");
      socket.off("settings_updated");
      socket.off("ready_status");
      socket.off("rematch_status");
      socket.off("time_update");
      socket.off("update_global_count");
      socket.off("update_room_count");
      socket.off("connection_status_update");
      socket.off("game_started");
      socket.off("game_finished");
      socket.off("move");
      socket.off("receive_message");
      socket.off("connect_error");
      socket.off("disconnect");
      socket.off("reconnect_attempt");
      socket.off("reconnect");
    };
  }, [joined, roomId, userId]); 

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) setJoined(true);
  };
  const updateSettings = (key: keyof TimeSettings, value: number | boolean) => {
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
       if (viewIndex > 0) setViewIndex(viewIndex - 1);
       return;
    }
    if (gameStatus === 'finished' || gameStatus === 'analysis') {
       if (history.length === 0) return;
       if(window.confirm("最新の1手を削除しますか？（全員に反映されます）")) socket.emit("undo", roomId);
       return;
    }
    if (gameStatus === 'playing') return;
    if (history.length === 0) return;
    if(window.confirm("1手戻しますか？")) socket.emit("undo", roomId);
  };
  const requestReset = () => {
    if(window.confirm("初期局面に戻しますか？（棋譜はすべて消えます）")) socket.emit("reset", roomId);
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
    socket.emit("send_message", { roomId, message: text, role: myRole, userName, userId });
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
        from: selectedSquare, to: coords, piece: piece.type, drop: false, isPromoted: mustPromote ? true : false 
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
          from: 'hand', to: coords, piece: selectedHandPiece, drop: true, isPromoted: false 
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
    
    const name = playerNames[owner] || (owner === 'sente' ? "先手" : "後手");
    const label = owner === 'sente' ? '☗ 先手' : '☖ 後手';

    const isWinner = winner === owner;
    const isOnline = connectionStatus[owner];
    const isMe = myRole === owner;

    // ★修正: 色のロジック
    // 1. 勝者は常に金色のまま
    // 2. 手番なら明るく
    // 3. それ以外は暗く
    let bgClass = "";
    if (isWinner) {
        bgClass = "bg-yellow-600 border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.6)]";
    } else if (isTurn) {
        bgClass = "bg-stone-800 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]";
    } else {
        bgClass = "bg-stone-900 border-stone-800 opacity-60";
    }

    // 離席していても、勝者の金色は残す（グレースケールにしない）
    // その代わり、少し透明度を下げて「いない感」を出す
    if (playerNames[owner] && !isOnline) {
        bgClass += " opacity-50"; 
    }

    return (
      <div className={`
        flex flex-col items-end px-3 py-1 rounded border-b-4 transition-all duration-500 min-w-[100px] relative
        ${bgClass}
      `}>
        {/* 離席中バッジ (赤色を強調) */}
        {playerNames[owner] && !isOnline && (
            <div className="absolute -top-2 left-0 bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow-md font-bold z-10 animate-pulse">
                離席中
            </div>
        )}

        <div className="flex flex-col items-end mb-1 w-full">
            <div className="flex items-center gap-1">
                {/* ★追加: 自分バッジ */}
                {isMe && <span className="text-[10px] bg-amber-700 text-amber-100 px-1 rounded">あなた</span>}
                <span className="text-sm text-stone-200 font-bold truncate max-w-[100px]">
                    {name}
                </span>
            </div>
            <span className="text-[10px] text-stone-500 font-mono">
                {label}
            </span>
        </div>
        
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
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4 relative">
        <form onSubmit={handleJoin} className="bg-stone-800 p-8 rounded-lg shadow-xl border border-amber-700/30 max-w-sm w-full space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-amber-100 font-serif">ShogiStack</h1>
            <div className="text-xs text-stone-500 mt-1 font-mono">
                🟢 現在 <span className="text-green-400 font-bold">{userCounts.global}</span> 人がオンライン
            </div>
          </div>
          <div>
            <label className="block text-stone-400 text-sm mb-2">ルーム名</label>
            <input 
              type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)}
              className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-white"
              placeholder="room1"
              required
            />
          </div>
          <div>
            <label className="block text-stone-400 text-sm mb-2">名前（ニックネーム）</label>
            <input 
              type="text" value={userName} onChange={(e) => setUserName(e.target.value)}
              className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-white"
              placeholder="名無し"
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

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col lg:flex-row items-center justify-start lg:justify-center p-2 gap-4 relative">
      <div className="flex flex-col items-center w-full max-w-lg shrink-0">
        
        {/* Header Info */}
        <div className="w-full max-w-lg flex justify-between items-center text-stone-400 text-sm px-1 mb-1">
          <div>Room: <span className="text-amber-200 font-mono">{roomId}</span></div>
          
          <div className="text-xs text-stone-500 font-mono flex gap-2">
             <span title="現在の部屋にいる人数">
                👤 {userCounts.room}人 <span className="text-stone-600">(観戦 {Math.max(0, userCounts.room - 2)})</span>
             </span>
          </div>

          <div className={`px-3 py-1 rounded text-xs font-bold border
              ${gameStatus === 'playing' ? 'bg-green-900 text-green-100 border-green-700' : 
                gameStatus === 'waiting' ? 'bg-blue-900 text-blue-100 border-blue-700' :
                'bg-stone-700 text-stone-300 border-stone-600'}
          `}>
            {gameStatus === 'playing' ? "対局中" : gameStatus === 'waiting' ? "対局待ち" : gameStatus === 'analysis' ? "検討中" : "感想戦"}
          </div>
        </div>

        {/* --- Top Area (相手) --- */}
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
                    <div className="flex items-center justify-between">
                       <label className="text-xs text-stone-400">振り駒 (ランダム)</label>
                       <input type="checkbox" checked={settings.randomTurn} onChange={(e) => updateSettings('randomTurn', e.target.checked)} className="w-4 h-4 accent-amber-600 cursor-pointer"/>
                    </div>
                    <div className={`flex items-center justify-between transition-opacity ${settings.randomTurn ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                       <label className="text-xs text-stone-400">再対局で固定</label>
                       <input type="checkbox" checked={settings.fixTurn} onChange={(e) => updateSettings('fixTurn', e.target.checked)} className="w-4 h-4 accent-amber-600 cursor-pointer" disabled={!settings.randomTurn}/>
                    </div>
                 </div>
                 {(myRole === 'sente' || myRole === 'gote') ? (
                   <div className="flex flex-col gap-3">
                     <button onClick={toggleReady} className={`font-bold py-3 px-6 rounded-full shadow-lg transition-all active:scale-95 ${readyStatus[myRole] ? 'bg-green-600 text-white hover:bg-green-500 ring-2 ring-green-400' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'}`}>{readyStatus[myRole] ? "準備完了！" : "準備完了"}</button>
                     <div className="text-xs text-stone-400 mt-2"><div>相手: <span className={readyStatus[myRole === 'sente' ? 'gote' : 'sente'] ? 'text-green-400 font-bold' : 'text-stone-500'}>{readyStatus[myRole === 'sente' ? 'gote' : 'sente'] ? "OK" : "準備中"}</span></div></div>
                   </div>
                 ) : ( <div className="text-stone-400 text-sm">設定中...</div> )}
               </div>
             </div>
          )}
        </div>

        {/* --- Bottom Area (自分) --- */}
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
                  {isLocalMode ? "同期に戻る " : "ローカル検討"}
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
                   <button onClick={requestUndo} className="bg-stone-700 text-stone-300 px-3 py-1 rounded text-xs hover:bg-stone-600">1手削除</button>
                   <button onClick={requestReset} className="bg-red-900/30 text-red-300 px-3 py-1 rounded text-xs hover:bg-red-900/50">初期局面へ</button>
                   {(myRole === 'sente' || myRole === 'gote') && (
                     <div className="flex flex-col items-center relative">
                       <button onClick={requestRematch} className={`px-3 py-1 rounded text-xs shadow font-bold transition-colors ${rematchRequests[myRole] ? 'bg-amber-800 text-stone-400' : 'bg-amber-700 text-white hover:bg-amber-600'}`} disabled={rematchRequests[myRole]}>{rematchRequests[myRole] ? "相手待ち..." : "再対局"}</button>
                       {rematchRequests[myRole === 'sente' ? 'gote' : 'sente'] && (<span className="text-[10px] text-green-400 absolute -top-4 w-full text-center animate-bounce font-bold">相手OK!</span>)}
                     </div>
                   )}
                   {myRole === 'audience' && <div className="text-[10px] text-stone-500">再対局待ち...</div>}
                 </>
               )}
             </div>
          </div>
        </div>
      </div>

      {/* --- 右側 (チャットエリア) --- */}
      <div className="w-full max-w-lg lg:max-w-xs h-[400px] lg:h-[600px] shrink-0">
        <Chat messages={chatMessages} onSendMessage={handleSendMessage} myRole={myRole} userId={userId} />
      </div>

    </div>
  );
};
export default App;