import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import ShogiBoard from '../components/ShogiBoard';
import Komadai from '../components/Komadai';
import Chat from '../components/Chat';
import { BoardState, Coordinates, Hand, Move, PieceType, Player } from '../types';
import { createInitialBoard, isValidMove, applyMove, exportKIF, getNyugyokuState, isKingInCheck } from '../utils/shogiUtils';
import { playSound } from '../utils/soundUtils';
import { getPromotionStatus } from '../utils/promotionUtils';
import { useGameSocket } from '../hooks/useGameSocket';
import { useMoveLogic } from '../hooks/useMoveLogic';
// ★追加: Firebase Auth関連をインポート
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

const EMPTY_HAND = {
  [PieceType.Pawn]: 0, [PieceType.Lance]: 0, [PieceType.Knight]: 0, [PieceType.Silver]: 0,
  [PieceType.Gold]: 0, [PieceType.Bishop]: 0, [PieceType.Rook]: 0, [PieceType.King]: 0,
  [PieceType.PromotedPawn]: 0, [PieceType.PromotedLance]: 0, [PieceType.PromotedKnight]: 0,
  [PieceType.PromotedSilver]: 0, [PieceType.Horse]: 0, [PieceType.Dragon]: 0,
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const GameRoom: React.FC = () => {
  const { roomId: paramRoomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const roomId = paramRoomId || "";
  const urlName = searchParams.get("name");
  const isAnalysisRoom = searchParams.get("mode") === 'analysis';

  const [isNameDecided, setIsNameDecided] = useState(!!urlName);
  const [userName, setUserName] = useState(urlName || "");
  const [inputName, setInputName] = useState(""); 
  const [userId, setUserId] = useState<string>("");

  useEffect(() => {
    if (urlName) {
      navigate(`/game/${roomId}${isAnalysisRoom ? '?mode=analysis' : ''}`, { replace: true });
    }
  }, [urlName, roomId, isAnalysisRoom, navigate]);

  // ★追加: ログイン状態を監視し、会員なら自動で名前とIDを設定して入力画面をスキップ
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // ログイン済みの場合
        // 名前はメールアドレスの@より前を使用（Lobbyと同じロジック）
        const name = user.displayName || user.email?.split('@')[0] || "Member";
        setUserName(name);
        setUserId(user.uid); // IDをFirebaseのUIDで上書き
        setIsNameDecided(true); // 名前決定フラグをONにしてフォームをスキップ
      }
    });
    return () => unsubscribe();
  }, []);

  // 未ログイン（ゲスト）用のID生成
  useEffect(() => {
    // すでにAuthでIDがセットされている場合は上書きしないようにチェックを入れても良いが、
    // Authチェックは非同期で後から来るため、とりあえず初期値として入れておく形でも動作はする。
    // ここでは「まだIDがない場合」のみ生成するようにする。
    if (!userId) { 
        let storedId = localStorage.getItem('shogi_user_id');
        if (!storedId) {
        storedId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('shogi_user_id', storedId);
        }
        setUserId(storedId);
    }
  }, [userId]);

  const [isFlipped, setIsFlipped] = useState(false);
  const [displayBoard, setDisplayBoard] = useState<BoardState>(createInitialBoard());
  const [displayHands, setDisplayHands] = useState<{ sente: Hand; gote: Hand }>({
    sente: { ...EMPTY_HAND }, gote: { ...EMPTY_HAND },
  });
  const [displayTurn, setDisplayTurn] = useState<Player>('sente'); 
  const [displayLastMove, setDisplayLastMove] = useState<{ from: Coordinates | 'hand'; to: Coordinates } | null>(null);
  const [viewIndex, setViewIndex] = useState<number>(0); 
  const [selectedSquare, setSelectedSquare] = useState<Coordinates | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<PieceType | null>(null);
  const [promotionCandidate, setPromotionCandidate] = useState<{ move: Move } | null>(null);
  const [isLocalMode, setIsLocalModeState] = useState(false);
  const lastSoundTime = useRef<number | null>(null);
  const [showNyugyokuModal, setShowNyugyokuModal] = useState(false);

  const {
    gameStatus, history, setHistory, myRole, playerNames, winner, readyStatus, rematchRequests,
    settings, times, setTimes, byoyomi, setByoyomi, chatMessages, userCounts, connectionStatus,
    lastServerTimeData, gameEndReason, isConnected, latency,
    updateSettings, toggleReady, resignGame, sendMove, requestUndo, requestReset, requestRematch, sendMessage, setIsLocalMode,
    declareWin
  } = useGameSocket(roomId, userId, userName, isAnalysisRoom, isNameDecided);

  const { processMove } = useMoveLogic({
    gameStatus, myRole, displayTurn, viewIndex, history, isLocalMode, sendMove, setHistory, setViewIndex,
  });

  const handleDirectJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputName.trim()) {
        setUserName(inputName);
        setIsNameDecided(true);
    }
  };

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
    if (!isLocalMode) {
        setViewIndex(history.length);
    }
    updateDisplay(history, viewIndex);
  }, [history, viewIndex, updateDisplay, isLocalMode]);

  useEffect(() => {
    if (myRole === 'gote') setIsFlipped(true);
    else if (myRole === 'sente') setIsFlipped(false);
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
  }, [gameStatus, displayTurn, lastServerTimeData, setTimes, setByoyomi]);

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

  // 入玉ステータス計算
  const senteState = getNyugyokuState(displayBoard, displayHands, 'sente');
  const goteState = getNyugyokuState(displayBoard, displayHands, 'gote');
  const myState = myRole === 'sente' ? senteState : myRole === 'gote' ? goteState : null;
  const isMyTurn = (myRole === displayTurn);
  
  let amInCheck = false;
  if (myRole === 'sente' || myRole === 'gote') {
      try {
          if (displayBoard) amInCheck = isKingInCheck(displayBoard, myRole);
      } catch(e) {}
  }

  const toggleLocalModeWrapper = () => {
    if (isLocalMode) {
      if (window.confirm("ローカル検討を終了し、最新の同期局面に戻りますか？")) {
        setIsLocalModeState(false);
        setIsLocalMode(false);
        setViewIndex(history.length);
      }
    } else {
      setIsLocalModeState(true);
      setIsLocalMode(true);
    }
  };

  const handleExit = () => {
    if (window.confirm("退室してロビーに戻りますか？")) {
      navigate('/'); 
    }
  };

  const copyRoomLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        alert("招待URLをコピーしました！\n友達に送って対局しよう！");
    });
  };

  const handleDeclareWin = () => {
    if (window.confirm("入玉宣言しますか？\n※条件を満たしていない場合は反則負けになります。")) {
      declareWin();
      setShowNyugyokuModal(false);
    }
  };

  const handleSquareClick = (coords: Coordinates) => {
    if (gameStatus === 'waiting' && !isAnalysisRoom) return;
    const clickedPiece = displayBoard[coords.y][coords.x];
    if (clickedPiece?.owner === displayTurn) {
      setSelectedSquare(coords);
      setSelectedHandPiece(null);
      return;
    }
    if (selectedSquare) {
      const piece = displayBoard[selectedSquare.y][selectedSquare.x];
      if (!piece) return;
      
      const status = getPromotionStatus(piece.type, selectedSquare.y, coords.y, displayTurn);
      const baseMove: Move = { 
        from: selectedSquare, to: coords, piece: piece.type, drop: false, isPromoted: false 
      };
      if (!isValidMove(displayBoard, displayHands, displayTurn, baseMove)) return; 

      if (status === 'must') {
        processMove({ ...baseMove, isPromoted: true });
        setSelectedSquare(null);
        return;
      }
      if (status === 'can') {
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
        if (isValidMove(displayBoard, displayHands, displayTurn, move)) {
          processMove(move);
        }
        setSelectedHandPiece(null);
      }
    }
  };

  const handleHandPieceClick = (piece: PieceType, owner: Player) => {
    if (gameStatus === 'waiting' && !isAnalysisRoom) return;
    if (owner !== displayTurn) return;
    setSelectedHandPiece(piece);
    setSelectedSquare(null);
  };

  const handlePromotionChoice = (promote: boolean) => {
    if (!promotionCandidate) return;
    processMove({ ...promotionCandidate.move, isPromoted: promote });
    setPromotionCandidate(null);
  };

  const copyKIF = () => {
    const kif = exportKIF(
        history, 
        createInitialBoard(),
        playerNames.sente || "先手",
        playerNames.gote || "後手",
        winner,
        gameEndReason,
        settings, 
        times,
        byoyomi
    );
    navigator.clipboard.writeText(kif).then(() => alert("KIFをコピーしました"));
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

    let bgClass = "";
    if (isWinner) {
        bgClass = "bg-yellow-600 border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.6)]";
    } else if (isTurn) {
        bgClass = "bg-stone-800 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]";
    } else {
        bgClass = "bg-stone-900 border-stone-800 opacity-60";
    }
    if (playerNames[owner] && !isOnline) {
        bgClass += " opacity-50"; 
    }

    return (
      <div className={`flex flex-col items-end px-3 py-1 rounded border-b-4 transition-all duration-500 min-w-[100px] relative ${bgClass}`}>
        {playerNames[owner] && !isOnline && (
            <div className="absolute -top-2 left-0 bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow-md font-bold z-10 animate-pulse">離席中</div>
        )}
        <div className="flex flex-col items-end mb-1 w-full">
            <div className="flex items-center gap-1">
                {isMe && <span className="text-[10px] bg-amber-700 text-amber-100 px-1 rounded">あなた</span>}
                <span className="text-sm text-stone-200 font-bold truncate max-w-[100px]">{name}</span>
            </div>
            <span className="text-[10px] text-stone-500 font-mono">{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
           <span className={`font-mono text-xl ${inByoyomi ? 'text-red-400' : 'text-stone-200'}`}>{formatTime(time)}</span>
           <span className={`font-mono text-sm ${inByoyomi && isTurn ? 'text-red-500 font-bold animate-pulse' : 'text-stone-500'}`}>{inByoyomi ? byo : settings.byoyomi}</span>
        </div>
      </div>
    );
  };

  // ★名前未決定の場合のみ入力フォームを表示
  if (!isNameDecided) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <form onSubmit={handleDirectJoin} className="bg-stone-800 p-8 rounded-lg shadow-xl border border-amber-700/30 max-w-sm w-full space-y-4 animate-in fade-in zoom-in duration-300">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-amber-100 font-serif">入室確認</h2>
            <p className="text-stone-500 text-xs mt-1">Room: <span className="font-mono text-amber-500">{roomId}</span></p>
          </div>
          <div>
            <label className="block text-stone-400 text-sm mb-2">ユーザー名を入力してください</label>
            <input 
              type="text" 
              value={inputName} 
              onChange={(e) => setInputName(e.target.value)} 
              className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-3 text-white focus:border-amber-500 focus:outline-none"
              placeholder="例: たろう"
              autoFocus
              required 
            />
          </div>
          <button type="submit" className="w-full bg-amber-700 hover:bg-amber-600 text-white font-bold py-3 rounded shadow-lg">
            入室する
          </button>
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
      {!isConnected && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-start pt-40 text-white backdrop-blur-sm animate-in fade-in duration-300">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mb-4"></div>
          <p className="text-xl font-bold tracking-wider">Starting Server...</p>
          <button 
             onClick={() => window.location.reload()}
             className="mt-6 text-sm text-stone-400 underline hover:text-white"
          >
             もし長時間動かない場合は再読み込み
          </button>
        </div>
      )}

      <div className="flex flex-col items-center w-full max-w-lg shrink-0">
        <div className="w-full max-w-lg flex justify-between items-center px-1 mb-2 mt-1">
          <div className={`px-4 py-1.5 rounded-full text-xs font-bold border flex items-center gap-2 shadow-sm ${gameStatus === 'playing' ? 'bg-green-900/80 text-green-100 border-green-700' : gameStatus === 'waiting' ? 'bg-blue-900/80 text-blue-100 border-blue-700' : 'bg-stone-800 text-stone-300 border-stone-600'}`}>
             <span className={`w-2 h-2 rounded-full ${gameStatus === 'playing' ? 'bg-green-400 animate-pulse' : 'bg-stone-500'}`}></span>
             {gameStatus === 'playing' ? "対局中" : gameStatus === 'waiting' ? "対局待ち" : gameStatus === 'analysis' ? "検討中" : "感想戦"}
          </div>
          <div className="flex items-center gap-3">
             {isAnalysisRoom && <span className="bg-indigo-900/80 text-indigo-200 text-[10px] px-2 py-1 rounded border border-indigo-700">検討室</span>}
             <div className="text-[10px] font-mono text-stone-500 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${latency < 100 ? 'bg-green-500' : latency < 300 ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                Ping: {latency}ms
             </div>
          </div>
        </div>

        <div className="w-full max-w-lg flex items-end justify-between mb-1 gap-2">
          <div className="flex-1 min-w-0"><Komadai hand={TopHand} owner={TopOwner} isCurrentTurn={displayTurn === TopOwner} onSelectPiece={(p) => handleHandPieceClick(p, TopOwner)} selectedPiece={displayTurn === TopOwner ? selectedHandPiece : null} /></div>
          <div>{renderTimer(TopOwner)}</div>
        </div>

        <div className="w-full max-w-lg relative" style={{ transition: 'transform 0.5s', transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
          <ShogiBoard board={displayBoard} onSquareClick={handleSquareClick} selectedSquare={selectedSquare} validMoves={[]} lastMove={displayLastMove} turn={displayTurn} />
          {promotionCandidate && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" style={{ transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
              <div className="pointer-events-auto bg-stone-800/95 p-3 rounded-lg border border-amber-500 shadow-[0_0_20px_rgba(0,0,0,0.5)] flex gap-4 animate-in fade-in zoom-in duration-100">
                <button onClick={() => handlePromotionChoice(true)} className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-6 rounded shadow active:scale-95 transition-all text-sm whitespace-nowrap">成る</button>
                <button onClick={() => handlePromotionChoice(false)} className="bg-stone-600 hover:bg-stone-500 text-stone-200 font-bold py-2 px-6 rounded shadow active:scale-95 transition-all text-sm whitespace-nowrap">成らず</button>
              </div>
            </div>
          )}
          {gameStatus === 'waiting' && !isAnalysisRoom && (
             <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 backdrop-blur-[2px]" style={{ transform: isFlipped ? 'rotate(180deg)' : 'none' }}>
               <div className="bg-stone-900/95 p-6 rounded-xl border border-amber-600 shadow-2xl text-center w-72">
                 <h2 className="text-amber-100 font-bold text-xl mb-4">対局設定</h2>
                 <div className="mb-6 space-y-4 text-left">
                    <div><label className="text-xs text-stone-400 flex justify-between"><span>持ち時間</span><span className="text-amber-400 font-mono">{Math.floor(settings.initial/60)}分</span></label><input type="range" min="0" max="3600" step="60" value={settings.initial} onChange={(e) => updateSettings('initial', Number(e.target.value))} className="w-full accent-amber-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"/></div>
                    <div><label className="text-xs text-stone-400 flex justify-between"><span>秒読み</span><span className="text-amber-400 font-mono">{settings.byoyomi}秒</span></label><input type="range" min="0" max="60" step="10" value={settings.byoyomi} onChange={(e) => updateSettings('byoyomi', Number(e.target.value))} className="w-full accent-amber-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer"/></div>
                    <div className="flex items-center justify-between"><label className="text-xs text-stone-400">振り駒 (ランダム)</label><input type="checkbox" checked={settings.randomTurn} onChange={(e) => updateSettings('randomTurn', e.target.checked)} className="w-4 h-4 accent-amber-600 cursor-pointer"/></div>
                    <div className={`flex items-center justify-between transition-opacity ${settings.randomTurn ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}><label className="text-xs text-stone-400">再対局で固定</label><input type="checkbox" checked={settings.fixTurn} onChange={(e) => updateSettings('fixTurn', e.target.checked)} className="w-4 h-4 accent-amber-600 cursor-pointer" disabled={!settings.randomTurn}/></div>
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

        <div className="w-full max-w-lg flex items-start justify-between mt-1 gap-2">
          <div className="flex-1 min-w-0"><Komadai hand={BottomHand} owner={BottomOwner} isCurrentTurn={displayTurn === BottomOwner} onSelectPiece={(p) => handleHandPieceClick(p, BottomOwner)} selectedPiece={displayTurn === BottomOwner ? selectedHandPiece : null} /></div>
          <div className="flex-shrink-0">{renderTimer(BottomOwner)}</div>
        </div>

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
              
              {(gameStatus === 'finished' || gameStatus === 'analysis' || isAnalysisRoom) && (
                <button 
                  onClick={toggleLocalModeWrapper}
                  className={`w-full py-2 rounded text-xs font-bold transition-all shadow-md ${isLocalMode ? 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white hover:from-blue-600 hover:to-indigo-600 border border-blue-500' : 'bg-stone-700 text-stone-300 hover:bg-stone-600 border border-stone-600'}`}
                >
                  {isLocalMode ? "同期に戻る " : "ローカル検討"}
                </button>
              )}
            </div>
          ) : ( 
            <div className="flex justify-center p-1 text-stone-600 text-xs font-mono">{viewIndex}手目</div> 
          )}

          <div className="flex justify-between items-center px-1">
             <div className="flex gap-3">
               <button onClick={handleExit} className="text-stone-500 hover:text-red-400 text-xs underline">← 退出</button>
               <button onClick={copyKIF} className="text-stone-500 hover:text-white text-xs underline">KIFコピー</button>
             </div>
             <div className="flex gap-2">
               {gameStatus === 'playing' && (
                 <button 
                   onClick={() => setShowNyugyokuModal(true)} 
                   className="bg-indigo-800 text-indigo-100 border border-indigo-600 px-3 py-1 rounded text-xs hover:bg-indigo-700 whitespace-nowrap"
                 >
                   入玉判定
                 </button>
               )}
               {gameStatus === 'playing' && (myRole === 'sente' || myRole === 'gote') && (
                  <button onClick={() => resignGame(myRole)} className="bg-stone-800 text-stone-400 border border-stone-600 px-4 py-2 rounded text-xs hover:bg-stone-700 hover:text-white">投了する</button>
               )}
               {(gameStatus === 'finished' || gameStatus === 'analysis' || isAnalysisRoom) && (
                 <>
                   <button onClick={requestUndo} className="bg-stone-700 text-stone-300 px-3 py-1 rounded text-xs hover:bg-stone-600">1手削除</button>
                   <button onClick={requestReset} className="bg-red-900/30 text-red-300 px-3 py-1 rounded text-xs hover:bg-red-900/50">初期局面へ</button>
                   {(myRole === 'sente' || myRole === 'gote') && (
                     <div className="flex flex-col items-center relative">
                       <button onClick={requestRematch} className={`px-3 py-1 rounded text-xs shadow font-bold transition-colors whitespace-nowrap ${rematchRequests[myRole] ? 'bg-amber-800 text-stone-400' : 'bg-amber-700 text-white hover:bg-amber-600'}`} disabled={rematchRequests[myRole]}>{rematchRequests[myRole] ? "待機中..." : "再対局"}</button>
                       {rematchRequests[myRole === 'sente' ? 'gote' : 'sente'] && (<span className="text-[10px] text-green-400 absolute -top-4 w-full text-center animate-bounce font-bold">相手OK!</span>)}
                     </div>
                   )}
                   {myRole === 'audience' && <div className="text-[10px] text-stone-500">再対局待ち...</div>}
                 </>
               )}
             </div>
          </div>

          <div className="w-full flex items-center justify-between gap-2 mt-2 p-2 bg-stone-900/50 rounded border border-stone-800 text-[10px] text-stone-500">
             <div className="flex items-center gap-2">
                <span>Room: <span className="font-mono text-stone-400">{roomId}</span></span>
                <button onClick={copyRoomLink} className="bg-stone-800 hover:bg-stone-700 text-amber-500 px-2 py-1 rounded border border-stone-700 flex items-center gap-1 transition-colors">
                  <span>🔗</span> 招待リンク
                </button>
             </div>
             <div className="flex items-center gap-1">
               <span>👤 {userCounts.room}人</span>
             </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-lg lg:max-w-xs h-[400px] lg:h-[600px] shrink-0">
        <Chat messages={chatMessages} onSendMessage={sendMessage} myRole={myRole} userId={userId} />
      </div>

      {showNyugyokuModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowNyugyokuModal(false)}>
          <div className="bg-stone-900 border border-stone-600 p-6 rounded-xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl text-stone-200 font-bold mb-4 text-center border-b border-stone-700 pb-2">入玉宣言条件確認</h3>
            <table className="w-full text-sm text-stone-300 mb-6">
              <thead>
                <tr className="border-b border-stone-700 text-stone-500">
                  <th className="py-2 text-left">条件</th>
                  <th className="py-2 text-center text-black bg-stone-300 rounded-t">☗ 先手</th>
                  <th className="py-2 text-center text-black bg-stone-300 rounded-t border-l border-stone-400">☖ 後手</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800">
                <tr>
                  <td className="py-3">玉が敵陣3段目以内</td>
                  <td className="text-center font-mono">{senteState.kingInZone ? "〇" : "×"}</td>
                  <td className="text-center font-mono">{goteState.kingInZone ? "〇" : "×"}</td>
                </tr>
                <tr>
                  <td className="py-3">敵陣の駒10枚以上<br/><span className="text-[10px] text-stone-500">(玉を除く)</span></td>
                  <td className={`text-center font-mono font-bold ${senteState.piecesInZone >= 10 ? 'text-green-400' : 'text-stone-500'}`}>{senteState.piecesInZone}枚</td>
                  <td className={`text-center font-mono font-bold ${goteState.piecesInZone >= 10 ? 'text-green-400' : 'text-stone-500'}`}>{goteState.piecesInZone}枚</td>
                </tr>
                <tr>
                  <td className="py-3">点数 (持駒+敵陣駒)<br/><span className="text-[10px] text-stone-500">(大駒5/小駒1, 玉除く)</span></td>
                  <td className={`text-center font-mono font-bold ${senteState.score >= 28 ? 'text-green-400' : 'text-stone-500'}`}>{senteState.score} / 28点</td>
                  <td className={`text-center font-mono font-bold ${goteState.score >= 27 ? 'text-green-400' : 'text-stone-500'}`}>{goteState.score} / 27点</td>
                </tr>
              </tbody>
            </table>

            {myState && (
              <div className="mt-6">
                <button 
                  onClick={handleDeclareWin}
                  disabled={!(myState.canDeclare && isMyTurn && !amInCheck)}
                  className={`w-full py-3 rounded font-bold text-lg shadow-lg transition-all border ${
                    myState.canDeclare && isMyTurn && !amInCheck 
                      ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.5)] animate-pulse cursor-pointer' 
                      : 'bg-stone-800 text-stone-500 border-stone-700 cursor-not-allowed'
                  }`}
                >
                  {myState.canDeclare && isMyTurn && !amInCheck 
                    ? "宣言して勝つ" 
                    : !isMyTurn ? "手番ではありません" 
                    : amInCheck ? "王手されています" 
                    : "宣言条件未達"}
                </button>
              </div>
            )}
            
            <button onClick={() => setShowNyugyokuModal(false)} className="mt-4 w-full text-stone-500 text-xs hover:text-stone-300 underline">
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameRoom;