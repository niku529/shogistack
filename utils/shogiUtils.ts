import { BoardState, Coordinates, Hand, Move, PieceType, Player, Piece } from '../types';
import { PIECE_KANJI } from '../constants';

const createInitialBoard = (): BoardState => {
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

const applyMove = (currentBoard: BoardState, currentHands: { sente: Hand; gote: Hand }, move: Move, currentTurn: Player) => {
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

const isValidMove = (board: BoardState, currentTurn: Player, move: Move): boolean => {
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

const toZenkaku = (n: number) => {
  const map = ['０', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
  return String(n).split('').map(c => map[Number(c)]).join('');
};

const toKanjiNum = (n: number) => {
  const map = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return map[n];
};

const formatKifTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatKifTotalTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// ★修正: KIF形式のエクスポート (分岐対応)
const exportKIF = (history: Move[], initialBoard: BoardState, branch?: { start: number, moves: Move[] } | null) => {
  const now = new Date();
  let kif = `#KIF version=2.0 encoding=UTF-8\n`;
  kif += `開始日時：${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}\n`;
  kif += `手合割：平手\n`;
  kif += `先手：\n`;
  kif += `後手：\n`;
  kif += `手数----指手---------消費時間--\n`;

  const generateMoveLines = (moves: Move[], offset: number = 0) => {
    let lines = "";
    moves.forEach((move, i) => {
      const index = offset + i + 1;
      const toX = 9 - move.to.x; 
      const toY = toKanjiNum(move.to.y + 1);
      
      let moveStr = "";
      // 直前の手を取得（offsetがある場合はhistoryから参照する等の考慮が必要だが、簡易的に同判定はbranch内では省略または直前チェックのみにする）
      // ここではbranch内でも同チェックを行う簡易実装
      const prevMove = i > 0 ? moves[i - 1] : (offset > 0 ? history[offset - 1] : null);
      const isSamePos = prevMove && prevMove.to.x === move.to.x && prevMove.to.y === move.to.y;

      if (isSamePos) {
        moveStr += "同　";
      } else {
        moveStr += `${toZenkaku(toX)}${toY}`;
      }

      const pieceName = PIECE_KANJI[move.piece];
      moveStr += pieceName;

      if (move.drop) {
        moveStr += "打";
      } else if (move.isPromoted) {
        moveStr += "成";
      }

      if (!move.drop) {
         const from = move.from as Coordinates;
         moveStr += `(${9 - from.x}${from.y + 1})`;
      }

      // スペース調整 (簡易)
      while (moveStr.length < 10) moveStr += "　";

      let timeStr = "";
      if (move.time) {
          timeStr = `( ${formatKifTime(move.time.now)}/${formatKifTotalTime(move.time.total)})`;
      } else {
          timeStr = `( 0:00/00:00:00)`; // 時間データがない場合
      }

      lines += `${String(index).padStart(4, ' ')} ${moveStr} ${timeStr}\n`;
    });
    return lines;
  };

  // メイン棋譜
  kif += generateMoveLines(history);

  // 変化棋譜
  if (branch) {
    kif += `\n変化：${branch.start + 1}手\n`;
    kif += generateMoveLines(branch.moves, branch.start);
  }

  return kif;
};

export { createInitialBoard, isValidMove, applyMove, exportKIF };