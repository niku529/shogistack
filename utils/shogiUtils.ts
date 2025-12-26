import { BoardState, Coordinates, Hand, Move, PieceType, Player, Piece } from '../types';
import { PIECE_KANJI } from '../constants';

// SFEN生成用のマップ定義
const SFEN_MAP: { [key in PieceType]: string } = {
  [PieceType.Pawn]: 'p', [PieceType.Lance]: 'l', [PieceType.Knight]: 'n',
  [PieceType.Silver]: 's', [PieceType.Gold]: 'g', [PieceType.Bishop]: 'b',
  [PieceType.Rook]: 'r', [PieceType.King]: 'k',
  [PieceType.PromotedPawn]: '+p', [PieceType.PromotedLance]: '+l',
  [PieceType.PromotedKnight]: '+n', [PieceType.PromotedSilver]: '+s',
  [PieceType.Horse]: '+b', [PieceType.Dragon]: '+r'
};

// --- 初期盤面生成 ---
export const createInitialBoard = (): BoardState => {
  const board: BoardState = Array(9).fill(null).map(() => Array(9).fill(null));
  
  const place = (x: number, y: number, type: PieceType, owner: Player) => {
    board[y][x] = { type, owner, isPromoted: false };
  };

  // Gote (後手)
  place(0, 0, PieceType.Lance, 'gote'); place(1, 0, PieceType.Knight, 'gote'); place(2, 0, PieceType.Silver, 'gote');
  place(3, 0, PieceType.Gold, 'gote'); place(4, 0, PieceType.King, 'gote'); place(5, 0, PieceType.Gold, 'gote');
  place(6, 0, PieceType.Silver, 'gote'); place(7, 0, PieceType.Knight, 'gote'); place(8, 0, PieceType.Lance, 'gote');
  place(1, 1, PieceType.Rook, 'gote'); place(7, 1, PieceType.Bishop, 'gote');
  for (let i = 0; i < 9; i++) place(i, 2, PieceType.Pawn, 'gote');

  // Sente (先手)
  place(0, 8, PieceType.Lance, 'sente'); place(1, 8, PieceType.Knight, 'sente'); place(2, 8, PieceType.Silver, 'sente');
  place(3, 8, PieceType.Gold, 'sente'); place(4, 8, PieceType.King, 'sente'); place(5, 8, PieceType.Gold, 'sente');
  place(6, 8, PieceType.Silver, 'sente'); place(7, 8, PieceType.Knight, 'sente'); place(8, 8, PieceType.Lance, 'sente');
  place(7, 7, PieceType.Rook, 'sente'); place(1, 7, PieceType.Bishop, 'sente');
  for (let i = 0; i < 9; i++) place(i, 6, PieceType.Pawn, 'sente');

  return board;
};

// --- ヘルパー関数群 ---

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

// --- 手の適用 ---
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

// --- 王手判定 ---
export const isKingInCheck = (board: BoardState, targetTurn: Player) => {
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

// --- 合法手があるか（詰んでいないか）チェック ---
export const hasLegalMoves = (board: BoardState, hands: {sente: Hand, gote: Hand}, turn: Player): boolean => {
  // 1. 盤上の駒の移動
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (p && p.owner === turn) {
        // 全マスへの移動を試行
        for (let ty = 0; ty < 9; ty++) {
          for (let tx = 0; tx < 9; tx++) {
            if (board[ty][tx]?.owner === turn) continue; // 自分の駒の上には行けない

            // まず幾何学的に動けるかチェック（軽い処理）
            if (!canPieceMoveTo(board, {x, y}, {x: tx, y: ty}, p, turn)) continue;

            const move: Move = { from: {x, y}, to: {x: tx, y: ty}, piece: p.type, drop: false, isPromoted: false };
            
            // ★重要: ここでは checkUchiFuzume=false で再帰を防ぐ
            if (isValidMove(board, hands, turn, move, false)) return true;

            // 成る移動のチェック
            const canPromote = [PieceType.Pawn, PieceType.Lance, PieceType.Knight, PieceType.Silver, PieceType.Bishop, PieceType.Rook].includes(p.type);
            if (canPromote) {
               const isZone = (turn === 'sente' ? (y <= 2 || ty <= 2) : (y >= 6 || ty >= 6));
               if (isZone) {
                  if (isValidMove(board, hands, turn, { ...move, isPromoted: true }, false)) return true;
               }
            }
          }
        }
      }
    }
  }

  // 2. 持ち駒を打つ
  const hand = hands[turn];
  for (const pieceType of Object.keys(hand)) {
    if (hand[pieceType as PieceType] > 0) {
      for (let ty = 0; ty < 9; ty++) {
        for (let tx = 0; tx < 9; tx++) {
          if (board[ty][tx] !== null) continue;
          const move: Move = { from: 'hand', to: {x: tx, y: ty}, piece: pieceType as PieceType, drop: true, isPromoted: false };
          if (isValidMove(board, hands, turn, move, false)) return true;
        }
      }
    }
  }

  return false; // 何も合法手がなければ「詰み」
};

// --- 合法手判定（メイン） ---
// 引数に hands を追加し、checkUchiFuzume フラグを追加
export const isValidMove = (board: BoardState, hands: {sente: Hand, gote: Hand}, currentTurn: Player, move: Move, checkUchiFuzume: boolean = true): boolean => {
  const { from, to, piece, drop, isPromoted } = move;

  if (to.x < 0 || to.x > 8 || to.y < 0 || to.y > 8) return false;
  const targetPiece = board[to.y][to.x];
  if (targetPiece && targetPiece.owner === currentTurn) return false;

  let isMoveOk = false;
  if (drop) {
    if (targetPiece !== null) return false;
    // 持ち駒があるかチェック
    if ((hands as any)[currentTurn][piece] <= 0) return false; 

    if (piece === PieceType.Pawn) {
      // 二歩チェック
      for (let y = 0; y < 9; y++) {
        const p = board[y][to.x];
        if (p && p.owner === currentTurn && p.type === PieceType.Pawn && !p.isPromoted) return false;
      }
    }
    // 行き所のない駒チェック
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

  // 自殺手（王手放置）チェック
  const next = applyMove(board, hands, move, currentTurn);
  if (isKingInCheck(next.board, currentTurn)) {
      return false; 
  }

  // ★打ち歩詰め判定
  // 歩打ちで、かつチェックを行う設定になっている場合
  if (checkUchiFuzume && drop && piece === PieceType.Pawn) {
    const nextTurn = currentTurn === 'sente' ? 'gote' : 'sente';
    // 1. 歩を打って王手になっているか
    if (isKingInCheck(next.board, nextTurn)) {
      // 2. 相手に逃げ場所（合法手）がないか
      // hasLegalMoves内でisValidMoveを呼ぶときは無限ループ防止のため checkUchiFuzume=false にする
      if (!hasLegalMoves(next.board, next.hands, nextTurn)) {
        return false; // 打ち歩詰めなので反則
      }
    }
  }

  return true;
};

// --- 詰み判定 ---
export const isCheckmate = (board: BoardState, hands: {sente: Hand, gote: Hand}, turn: Player): boolean => {
  // 王手がかかっていて、かつ逃げ場所がない
  return isKingInCheck(board, turn) && !hasLegalMoves(board, hands, turn);
};

// --- SFEN生成 ---
export const generateSFEN = (board: BoardState, turn: Player, hands: {sente: Hand, gote: Hand}): string => {
  let sfen = "";
  for (let y = 0; y < 9; y++) {
    let empty = 0;
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (!p) {
        empty++;
        continue;
      }
      if (empty > 0) {
        sfen += empty;
        empty = 0;
      }
      let char = SFEN_MAP[p.type] || '?';
      if (p.owner === 'sente') char = char.toUpperCase();
      sfen += char;
    }
    if (empty > 0) sfen += empty;
    if (y < 8) sfen += "/";
  }
  
  sfen += ` ${turn === 'sente' ? 'b' : 'w'}`; // 手番 (b:先手, w:後手)

  // 持ち駒
  let handStr = "";
  // 先手 (S)
  const order = [PieceType.Rook, PieceType.Bishop, PieceType.Gold, PieceType.Silver, PieceType.Knight, PieceType.Lance, PieceType.Pawn];
  for (const type of order) {
    const count = hands.sente[type];
    if (count > 0) {
      if (count > 1) handStr += count;
      handStr += SFEN_MAP[type].toUpperCase();
    }
  }
  // 後手 (G)
  for (const type of order) {
    const count = hands.gote[type];
    if (count > 0) {
      if (count > 1) handStr += count;
      handStr += SFEN_MAP[type];
    }
  }
  
  if (handStr === "") handStr = "-";
  sfen += ` ${handStr}`;
  sfen += " 1"; // 手数（簡易的に1）

  return sfen;
};

// --- 入玉宣言法（27点法）関連ロジック ---

const PIECE_POINTS: { [key in PieceType]?: number } = {
  [PieceType.Pawn]: 1, [PieceType.Lance]: 1, [PieceType.Knight]: 1, [PieceType.Silver]: 1,
  [PieceType.Gold]: 1, [PieceType.Bishop]: 5, [PieceType.Rook]: 5,
  [PieceType.PromotedPawn]: 1, [PieceType.PromotedLance]: 1, [PieceType.PromotedKnight]: 1,
  [PieceType.PromotedSilver]: 1, [PieceType.Horse]: 5, [PieceType.Dragon]: 5,
  [PieceType.King]: 0
};

// 特定のプレイヤーの入玉ステータスを計算
export const getNyugyokuState = (board: BoardState, hands: {sente: Hand, gote: Hand}, player: Player) => {
  let score = 0;
  let piecesInZone = 0;
  let kingInZone = false;

  // 敵陣の定義（先手なら0-2段目、後手なら6-8段目）
  const isZone = (y: number) => player === 'sente' ? (y <= 2) : (y >= 6);

  // 1. 盤上の駒計算
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (p && p.owner === player) {
        if (p.type === PieceType.King) {
          if (isZone(y)) kingInZone = true;
        } else {
          // ★修正: 敵陣にある場合のみカウント＆加点
          if (isZone(y)) {
            score += PIECE_POINTS[p.type] || 0;
            piecesInZone++;
          }
        }
      }
    }
  }

  // 2. 持ち駒の点数加算（枚数には含めない）
  const hand = hands[player];
  for (const type of Object.keys(hand) as PieceType[]) {
    const count = hand[type];
    if (count > 0) {
      score += count * (PIECE_POINTS[type] || 0);
    }
  }

  // 3. 条件判定
  // 条件: 玉が敵陣、点数が規定以上(先手28/後手27)、敵陣の駒が10枚以上
  const requiredScore = player === 'sente' ? 28 : 27;
  const canDeclare = kingInZone && piecesInZone >= 10 && score >= requiredScore;

  return {
    score,
    piecesInZone,
    kingInZone,
    canDeclare,
    requiredScore // 表示用に目標点も返す
  };
};


// --- KIF出力用フォーマット関数 ---

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
               loserTotalConsumed = Math.max(0, timeSettings.initial - remainingTimes[loser]);
               resignThinkTime = Math.max(0, loserTotalConsumed - loserPrevTotal);
            } else {
               if (timeSettings.byoyomi > 0) {
                  const currentByoyomiUsed = Math.max(0, timeSettings.byoyomi - remainingByoyomi[loser]);
                  loserTotalConsumed = loserPrevTotal + currentByoyomiUsed;
                  resignThinkTime = currentByoyomiUsed;
               } else {
                  loserTotalConsumed = timeSettings.initial;
                  resignThinkTime = Math.max(0, loserTotalConsumed - loserPrevTotal);
               }
            }

            timeStr = `( ${formatKifTime(resignThinkTime)}/${formatKifTotalTime(loserTotalConsumed)})`;
        }
    } else if (endReason === 'sennichite') endStr = "千日手";
    else if (endReason === 'illegal_sennichite') endStr = "反則負け";
    else if (endReason === 'try') endStr = "入玉宣言勝ち"; 
    else if (endReason === 'checkmate') endStr = "詰み"; 

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