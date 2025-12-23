import React, { useRef, useCallback } from 'react'; // ★ここを修正 (Reactを追加)
import { Move, GameStatus, Role, Player } from '../types';
import { playSound } from '../utils/soundUtils';

// フックが受け取るべき引数の型定義
interface UseMoveLogicProps {
  gameStatus: GameStatus;
  myRole: Role;
  displayTurn: Player;
  viewIndex: number;
  history: Move[];
  isLocalMode: boolean;
  
  // Socketフックから来る関数たち
  sendMove: (move: Move, viewIndex?: number, isReview?: boolean) => void;
  setHistory: React.Dispatch<React.SetStateAction<Move[]>>;
  setViewIndex: (index: number) => void;
}

export const useMoveLogic = ({
  gameStatus,
  myRole,
  displayTurn,
  viewIndex,
  history,
  isLocalMode,
  sendMove,
  setHistory,
  setViewIndex,
}: UseMoveLogicProps) => {
  
  const isProcessingMove = useRef(false);

  // 以前 App.tsx にあった processMoveLogic をここに移植
  const processMove = useCallback((move: Move) => {
    // 1. ルール/状態チェック
    if (gameStatus === 'playing') {
      if (myRole !== 'sente' && myRole !== 'gote') return;
      if (myRole !== displayTurn) return;
      if (viewIndex !== history.length) {
        alert("最新の局面に戻ってください");
        return;
      }
    }

    // 2. 連打防止
    if (isProcessingMove.current) return;

    // 3. ローカルモードの分岐
    if (isLocalMode) {
       setHistory(prev => {
          const truncated = prev.slice(0, viewIndex);
          return [...truncated, move];
       });
       setViewIndex(viewIndex + 1);
       playSound('move');
       return;
    }

    // 4. サーバー通信モード
    isProcessingMove.current = true;
    const isReview = gameStatus === 'finished' || gameStatus === 'analysis';
    
    // 送信
    sendMove(move, viewIndex, isReview);

    // 楽観的更新 (Optimistic UI)
    if (isReview && viewIndex < history.length) {
       setHistory(prev => {
          const truncated = prev.slice(0, viewIndex);
          return [...truncated, move];
       });
    } else {
       setHistory(prev => [...prev, move]);
    }
    
    // 連打ガード解除
    setTimeout(() => { isProcessingMove.current = false; }, 500);
    
    // 5. 状態更新と音
    setViewIndex(viewIndex + 1);
    playSound('move');

  }, [gameStatus, myRole, displayTurn, viewIndex, history, isLocalMode, sendMove, setHistory, setViewIndex]);

  return { processMove };
};