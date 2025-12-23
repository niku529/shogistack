import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Move, Player, TimeSettings, GameStatus, Role } from '../types';
import { playSound } from '../utils/soundUtils';

// Socketインスタンスはフックの外で定義（シングルトン）
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

// ヘルパー関数
const isSameMove = (a: Move, b: Move) => {
  const fromA = typeof a.from === 'string' ? a.from : `${a.from.x},${a.from.y}`;
  const fromB = typeof b.from === 'string' ? b.from : `${b.from.x},${b.from.y}`;
  return fromA === fromB &&
         a.to.x === b.to.x && a.to.y === b.to.y &&
         a.piece === b.piece && a.drop === b.drop && !!a.isPromoted === !!b.isPromoted;
};

export const useGameSocket = (
  roomId: string,
  userId: string,
  userName: string,
  isAnalysisRoom: boolean,
  joined: boolean
) => {
  // --- State ---
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [history, setHistory] = useState<Move[]>([]);
  const [myRole, setMyRole] = useState<Role>('audience');
  const [playerNames, setPlayerNames] = useState<{sente: string | null, gote: string | null}>({sente: null, gote: null});
  const [winner, setWinner] = useState<Player | null>(null);
  const [readyStatus, setReadyStatus] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [rematchRequests, setRematchRequests] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  const [settings, setSettings] = useState<TimeSettings>({ initial: 600, byoyomi: 30, randomTurn: false, fixTurn: false });
  const [times, setTimes] = useState<{sente: number, gote: number}>({sente: 600, gote: 600});
  const [byoyomi, setByoyomi] = useState<{sente: number, gote: number}>({sente: 30, gote: 30});
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [userCounts, setUserCounts] = useState<{global: number, room: number}>({ global: 0, room: 0 });
  const [connectionStatus, setConnectionStatus] = useState<{sente: boolean, gote: boolean}>({sente: false, gote: false});
  
  // ★追加: 終局理由
  const [gameEndReason, setGameEndReason] = useState<string | null>(null);

  // UI制御のためのRefやコールバック用
  const lastServerTimeData = useRef<{ times: {sente: number, gote: number}, byoyomi: {sente: number, gote: number}, receivedAt: number } | null>(null);
  const isLocalModeRef = useRef(false); // ローカルモード判定用

  // --- Socket Event Listeners ---
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
        setHistory(data.history);
        setGameStatus(data.status);
        setWinner(data.winner as Player | null);
        setReadyStatus(data.ready || {sente: false, gote: false});
        setRematchRequests(data.rematchRequests || {sente: false, gote: false});
        
        // ★同期時に理由があれば復元（サーバーの実装次第ですが安全のため）
        if (data.status === 'finished' && data.reason) {
            setGameEndReason(data.reason);
        }

        if (data.settings) setSettings(data.settings);
        if (data.times) {
           setTimes(data.times);
           lastServerTimeData.current = { times: data.times, byoyomi: {sente:30, gote:30}, receivedAt: Date.now() };
        }
        if (data.yourRole) setMyRole(data.yourRole as Role);
        if (data.playerNames) setPlayerNames(data.playerNames);
      });

      socket.on("player_names_updated", setPlayerNames);
      socket.on("settings_updated", setSettings);
      socket.on("ready_status", setReadyStatus);
      socket.on("rematch_status", setRematchRequests);
      
      socket.on("time_update", (data: { times: any, currentByoyomi: any }) => {
        lastServerTimeData.current = {
          times: data.times,
          byoyomi: data.currentByoyomi,
          receivedAt: Date.now()
        };
      });

      socket.on("update_room_count", (count: number) => setUserCounts(prev => ({ ...prev, room: count })));
      socket.on("connection_status_update", setConnectionStatus);

      socket.on("game_started", () => {
        setIsLocalMode(false); 
        setHistory([]);
        setGameStatus('playing');
        setWinner(null);
        setGameEndReason(null); // ★リセット
        setRematchRequests({sente: false, gote: false});
        playSound('alert');
        alert("対局開始！お願いします。");
      });

      socket.on("game_finished", (data: { winner: Player | null, reason?: string }) => {
        setGameStatus('finished');
        setWinner(data.winner);
        setGameEndReason(data.reason || null); // ★理由を保存
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
        lastServerTimeData.current = null; 
        setHistory(prev => {
          const last = prev[prev.length - 1];
          if (last && isSameMove(last, move)) {
            const newHistory = [...prev];
            newHistory[newHistory.length - 1] = move;
            return newHistory;
          }
          playSound('move');
          return [...prev, move];
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

  // --- Client Actions (サーバーへの送信) ---
  const updateSettings = useCallback((key: keyof TimeSettings, value: number | boolean) => {
    const newSettings = { ...settings, [key]: value };
    socket.emit("update_settings", { roomId, settings: newSettings });
  }, [settings, roomId]);

  const toggleReady = useCallback(() => {
    if (myRole === 'sente' || myRole === 'gote') socket.emit("toggle_ready", { roomId, role: myRole });
  }, [myRole, roomId]);

  const resignGame = useCallback((loser: Player) => {
    if(window.confirm("本当に投了しますか？")) socket.emit("game_resign", { roomId, loser });
  }, [roomId]);

  const sendMove = useCallback((move: Move, viewIndex?: number, isFinishedOrAnalysis?: boolean) => {
    if (isFinishedOrAnalysis) {
       socket.emit("move", { roomId, move, branchIndex: viewIndex });
    } else {
       socket.emit("move", { roomId, move });
    }
  }, [roomId]);

  const requestUndo = useCallback(() => {
    if(window.confirm("1手戻しますか？")) socket.emit("undo", roomId);
  }, [roomId]);

  const requestUndoForce = useCallback(() => {
    if(window.confirm("最新の1手を削除しますか？（全員に反映されます）")) socket.emit("undo", roomId);
  }, [roomId]);

  const requestReset = useCallback(() => {
    if(window.confirm("初期局面に戻しますか？（棋譜はすべて消えます）")) socket.emit("reset", roomId);
  }, [roomId]);

  const requestRematch = useCallback(() => {
    if (myRole === 'sente' || myRole === 'gote') socket.emit("rematch", { roomId, role: myRole });
    else alert("観戦者は提案できません");
  }, [myRole, roomId]);

  const sendMessage = useCallback((text: string) => {
    socket.emit("send_message", { roomId, message: text, role: myRole, userName, userId });
  }, [roomId, myRole, userName, userId]);

  const setIsLocalMode = (val: boolean) => {
      isLocalModeRef.current = val;
  };

  return {
    // State
    gameStatus,
    history,
    setHistory,
    myRole,
    playerNames,
    winner,
    readyStatus,
    rematchRequests,
    settings,
    times,
    setTimes, 
    byoyomi,
    setByoyomi, 
    chatMessages,
    userCounts,
    connectionStatus,
    lastServerTimeData, 
    isLocalModeRef,     
    gameEndReason, // ★追加

    // Actions
    updateSettings,
    toggleReady,
    resignGame,
    sendMove,
    requestUndo,
    requestUndoForce,
    requestReset,
    requestRematch,
    sendMessage,
    setIsLocalMode
  };
};