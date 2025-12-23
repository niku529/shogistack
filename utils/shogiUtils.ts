import { BoardState, Coordinates, Hand, Move, PieceType, Player, Piece } from '../types';
import { PIECE_KANJI } from '../constants';
import { SENTE_PROMOTION_ZONE, GOTE_PROMOTION_ZONE } from '../constants';

export const createInitialBoard = (): BoardState => {
  const board: BoardState = Array(9).fill(null).map(() => Array(9).fill(null));
  
  const place = (x: number, y: number, type: PieceType, owner: Player) => {
    board[y][x] = { type, owner, isPromoted: false };
  };

  // Gote
  place(0, 0, PieceType.Lance, 'gote'); place(1, 0, PieceType.Knight, 'gote'); place(2, 0, PieceType.Silver, 'gote');
  place(3, 0, PieceType.Gold, 'gote'); place(4, 0, PieceType.King, 'gote'); place(5, 0, PieceType.Gold, 'gote');
  place(6, 0, PieceType.Silver, 'gote'); place(7, 0, PieceType.Knight, 'gote'); place(8, 0, PieceType.Lance, 'gote');
  place(1, 1, PieceType.Rook, 'gote'); place(7, 1, PieceType.Bishop, 'gote');
  for (let i = 0; i < 9; i++) place(i, 2, PieceType.Pawn, 'gote');

  // Sente
  place(0, 8, PieceType.Lance, 'sente'); place(1, 8, PieceType.Knight, 'sente'); place(2, 8, PieceType.Silver, 'sente');
  place(3, 8, PieceType.Gold, 'sente'); place(4, 8, PieceType.King, 'sente'); place(5, 8, PieceType.Gold, 'sente');
  place(6, 8, PieceType.Silver, 'sente'); place(7, 8, PieceType.Knight, 'sente'); place(8, 8, PieceType.Lance, 'sente');
  place(7, 7, PieceType.Rook, 'sente'); place(1, 7, PieceType.Bishop, 'sente');
  for (let i = 0; i < 9; i++) place(i, 6, PieceType.Pawn, 'sente');

  return board;
};

const getReversePieceType = (type: PieceType): PieceType => {
  switch (type) {
    case PieceType.PromotedPawn: return PieceType.Pawn;
    case PieceType.PromotedLance: return PieceType.Lance;
    case PieceType.PromotedKnight: return PieceType.Knight;
    case PieceType.PromotedSilver: return PieceType.Silver;
    case PieceType.Horse: return PieceType.Bishop;
    case PieceType.Dragon: return PieceType.Rook;
    default: return type;
  }
};

const promotePiece = (type: PieceType): PieceType => {
  switch (type) {
    case PieceType.Pawn: return PieceType.PromotedPawn;
    case PieceType.Lance: return PieceType.PromotedLance;
    case PieceType.Knight: return PieceType.PromotedKnight;
    case PieceType.Silver: return PieceType.PromotedSilver;
    case PieceType.Bishop: return PieceType.Horse;
    case PieceType.Rook: return PieceType.Dragon;
    default: return type;
  }
};

const hasObstacle = (x1: number, y1: number, x2: number, y2: number, board: BoardState) => {
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  let x = x1 + dx;
  let y = y1 + dy;
  while (x !== x2 || y !== y2) {
    if (board[y][x] !== null) return true;
    x += dx;
    y += dy;
  }
  return false;
};

const canPieceMoveTo = (board: BoardState, from: Coordinates, to: Coordinates, pieceObj: Piece, currentTurn: Player) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const forward = currentTurn === 'sente' ? -1 : 1;
  const type = pieceObj.type;
  const promoted = pieceObj.isPromoted;

  const goldMove = () => {
    const absDx = Math.abs(dx);
    if ((absDx === 1 && dy === 0) || (absDx === 0 && Math.abs(dy) === 1)) return true;
    if (absDx === 1 && dy === forward) return true;
    return false;
  };

  switch (type) {
    case PieceType.Pawn: return !promoted ? (dx === 0 && dy === forward) : goldMove();
    case PieceType.King: return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
    case PieceType.Gold: return goldMove();
    case PieceType.Silver:
      if (promoted) return goldMove();
      if (Math.abs(dx) <= 1 && dy === forward) return true;
      if (Math.abs(dx) === 1 && dy === -forward) return true;
      return false;
    case PieceType.Knight:
      if (promoted) return goldMove();
      return Math.abs(dx) === 1 && dy === (forward * 2);
    case PieceType.Lance:
      if (promoted) return goldMove();
      if (dx !== 0) return false;
      if (currentTurn === 'sente' ? (dy >= 0) : (dy <= 0)) return false;
      return !hasObstacle(from.x, from.y, to.x, to.y, board);
    case PieceType.Bishop: case PieceType.Horse:
      if (Math.abs(dx) === Math.abs(dy)) return !hasObstacle(from.x, from.y, to.x, to.y, board);
      if (promoted && (Math.abs(dx) + Math.abs(dy) === 1)) return true;
      return false;
    case PieceType.Rook: case PieceType.Dragon:
      if (dx === 0 || dy === 0) return !hasObstacle(from.x, from.y, to.x, to.y, board);
      if (promoted && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return true;
      return false;
    default: return goldMove();
  }
};

export const applyMove = (currentBoard: BoardState, currentHands: { sente: Hand; gote: Hand }, move: Move, currentTurn: Player) => {
  const newBoard = currentBoard.map(row => row.map(p => p ? { ...p } : null));
  const newHands = { 
    sente: { ...currentHands.sente }, 
    gote: { ...currentHands.gote } 
  };
  const nextTurn = currentTurn === 'sente' ? 'gote' : 'sente';

  if (move.drop) {
    if (typeof move.from === 'string') {
        newBoard[move.to.y][move.to.x] = { type: move.piece, owner: currentTurn, isPromoted: false };
        newHands[currentTurn][move.piece]--;
    }
  } else {
    const from = move.from as Coordinates;
    const piece = newBoard[from.y][from.x];
    if (piece) {
        const targetSquare = newBoard[move.to.y][move.to.x];
        if (targetSquare) {
          const capturedType = getReversePieceType(targetSquare.type);
          newHands[currentTurn][capturedType]++;
        }
        const newType = move.isPromoted ? promotePiece(piece.type) : piece.type;
        newBoard[move.to.y][move.to.x] = { ...piece, type: newType, isPromoted: move.isPromoted || piece.isPromoted };
        newBoard[from.y][from.x] = null;
    }
  }
  return { board: newBoard, hands: newHands, turn: nextTurn };
};

const isKingInCheck = (board: BoardState, targetTurn: Player) => {
  const attackerTurn = targetTurn === 'sente' ? 'gote' : 'sente';
  let kingPos: Coordinates | null = null;

  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (p && p.type === PieceType.King && p.owner === targetTurn) {
        kingPos = { x, y };
        break;
      }
    }
    if (kingPos) break;
  }
  if (!kingPos) return false;

  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (p && p.owner === attackerTurn) {
        if (canPieceMoveTo(board, {x, y}, kingPos, p, attackerTurn)) {
          return true;
        }
      }
    }
  }
  return false;
};

export const isValidMove = (board: BoardState, currentTurn: Player, move: Move): boolean => {
  const { from, to, piece, drop, isPromoted } = move;

  if (to.x < 0 || to.x > 8 || to.y < 0 || to.y > 8) return false;
  const targetPiece = board[to.y][to.x];
  if (targetPiece && targetPiece.owner === currentTurn) return false;

  let isMoveOk = false;
  if (drop) {
    if (targetPiece !== null) return false;
    if (piece === PieceType.Pawn) {
      for (let y = 0; y < 9; y++) {
        const p = board[y][to.x];
        if (p && p.owner === currentTurn && p.type === PieceType.Pawn && !p.isPromoted) return false;
      }
    }
    if (currentTurn === 'sente') {
      if ((piece === PieceType.Pawn || piece === PieceType.Lance) && to.y === 0) return false;
      if (piece === PieceType.Knight && to.y <= 1) return false;
    } else {
      if ((piece === PieceType.Pawn || piece === PieceType.Lance) && to.y === 8) return false;
      if (piece === PieceType.Knight && to.y >= 7) return false;
    }
    isMoveOk = true;
  } else {
    if (typeof from === 'string') return false; 
    const movingPiece = board[from.y][from.x];
    if (!movingPiece || movingPiece.owner !== currentTurn) return false;
    isMoveOk = canPieceMoveTo(board, from, to, movingPiece, currentTurn);
  }

  if (!isMoveOk) return false;

  const dummyHands = { 
      sente: { [PieceType.Pawn]: 100 } as any, 
      gote: { [PieceType.Pawn]: 100 } as any 
  };
  const next = applyMove(board, dummyHands, move, currentTurn);
  
  if (isKingInCheck(next.board, currentTurn)) {
      return false; 
  }

  return true;
};

const formatKifTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, ' ')}:${s.toString().padStart(2, '0')}`;
};

const formatKifTotalTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const exportKIF = (
  history: Move[],
  initialBoard: BoardState,
  senteName?: string,
  goteName?: string,
  winner?: Player | null,
  endReason?: string | null,
  timeSettings?: { initial: number, byoyomi: number },
  remainingTimes?: { sente: number, gote: number },
  remainingByoyomi?: { sente: number, gote: number }
): string => {
  const header = `
手合割：平手
先手：${senteName || '不明'}
後手：${goteName || '不明'}
手数----指手---------消費時間--
`.trim();

  let body = "";

  history.forEach((move, index) => {
    const num = index + 1;
    const paddedNum = num.toString().padStart(4, ' ');
    
    const toX = ['１','２','３','４','５','６','７','８','９'][9 - (move.to.x + 1)];
    const toY = ['一','二','三','四','五','六','七','八','九'][move.to.y];
    
    let pieceName = "";
    switch(move.piece) {
      case PieceType.Pawn: pieceName = "歩"; break;
      case PieceType.Lance: pieceName = "香"; break;
      case PieceType.Knight: pieceName = "桂"; break;
      case PieceType.Silver: pieceName = "銀"; break;
      case PieceType.Gold: pieceName = "金"; break;
      case PieceType.Bishop: pieceName = "角"; break;
      case PieceType.Rook: pieceName = "飛"; break;
      case PieceType.King: pieceName = "玉"; break;
      case PieceType.PromotedPawn: pieceName = "と"; break;
      case PieceType.PromotedLance: pieceName = "成香"; break;
      case PieceType.PromotedKnight: pieceName = "成桂"; break;
      case PieceType.PromotedSilver: pieceName = "成銀"; break;
      case PieceType.Horse: pieceName = "馬"; break;
      case PieceType.Dragon: pieceName = "龍"; break;
    }

    let moveStr = "";
    const prevMove = index > 0 ? history[index - 1] : null;
    
    if (prevMove && prevMove.to.x === move.to.x && prevMove.to.y === move.to.y) {
      moveStr = "同　" + pieceName;
    } else {
      moveStr = `${toX}${toY}${pieceName}`;
    }

    if (move.drop) {
      moveStr += "打";
    } else if (move.isPromoted) {
      moveStr += "成";
    }

    let fromStr = "";
    if (move.drop) {
       // 打
    } else {
        if (typeof move.from !== 'string') {
            const fromX = 9 - move.from.x;
            const fromY = move.from.y + 1;
            fromStr = `(${fromX}${fromY})`;
        }
    }

    const nowTime = move.time ? move.time.now : 0;
    const totalTime = move.time ? move.time.total : 0;
    
    const timeStr = `( ${formatKifTime(nowTime)}/${formatKifTotalTime(totalTime)})`;
    const moveContent = moveStr + fromStr;
    body += `${paddedNum} ${moveContent.padEnd(16, ' ')} ${timeStr}\n`;
  });

  if (endReason) {
    const lastNum = (history.length + 1).toString().padStart(4, ' ');
    let endStr = "";
    let timeStr = "( 0:00/00:00:00)"; 

    // ★修正: 投了(resign) と 切れ負け(timeout) 両方で計算を行う
    if (endReason === 'resign' || endReason === 'timeout') {
        endStr = endReason === 'resign' ? "投了" : "切れ負け";
        
        if (winner && timeSettings && remainingTimes && remainingByoyomi) {
            const loser = winner === 'sente' ? 'gote' : 'sente';
            
            let loserPrevTotal = 0;
            for (let i = history.length - 1; i >= 0; i--) {
                const m = history[i];
                const moveOwner = (i % 2 === 0) ? 'sente' : 'gote';
                if (moveOwner === loser) {
                    loserPrevTotal = m.time ? m.time.total : 0;
                    break;
                }
            }

            let resignThinkTime = 0;
            let loserTotalConsumed = 0;

            if (remainingTimes[loser] > 0) {
               // 通常消費
               loserTotalConsumed = Math.max(0, timeSettings.initial - remainingTimes[loser]);
               resignThinkTime = Math.max(0, loserTotalConsumed - loserPrevTotal);
            } else {
               // 持ち時間切れ後の処理
               if (timeSettings.byoyomi > 0) {
                  // 秒読みモード: 秒読み分を加算
                  const currentByoyomiUsed = Math.max(0, timeSettings.byoyomi - remainingByoyomi[loser]);
                  loserTotalConsumed = loserPrevTotal + currentByoyomiUsed;
                  resignThinkTime = currentByoyomiUsed;
               } else {
                  // 秒読みなし（切れ負けルール）: 持ち時間を全て使い切ったとみなす
                  loserTotalConsumed = timeSettings.initial;
                  resignThinkTime = Math.max(0, loserTotalConsumed - loserPrevTotal);
               }
            }

            timeStr = `( ${formatKifTime(resignThinkTime)}/${formatKifTotalTime(loserTotalConsumed)})`;
        }
    } else if (endReason === 'sennichite') endStr = "千日手";
    else if (endReason === 'illegal_sennichite') endStr = "反則負け";
    else if (endReason === 'try') endStr = "入玉宣言勝ち"; 

    if (endStr) {
       body += `${lastNum} ${endStr.padEnd(16, ' ')} ${timeStr}\n`;
    }
  }

  let resultStr = "";
  if (winner) {
     const winName = winner === 'sente' ? '先手' : '後手';
     resultStr = `まで${history.length}手で${winName}の勝ち`;
  } else if (endReason === 'sennichite') {
     resultStr = `まで${history.length}手で千日手`;
  }

  return `${header}\n${body}${resultStr}\n`;
};