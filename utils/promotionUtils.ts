import { PieceType, Player } from '../types';
import { SENTE_PROMOTION_ZONE, GOTE_PROMOTION_ZONE } from '../constants';

type PromotionStatus = 'must' | 'can' | 'none';

export const getPromotionStatus = (
  pieceType: PieceType,
  fromY: number,
  toY: number,
  turn: Player
): PromotionStatus => {
  // 金と玉は成れない
  if (pieceType === PieceType.Gold || pieceType === PieceType.King) {
    return 'none';
  }
  // 既に成っている駒は成れない
  if (
    [
      PieceType.PromotedPawn,
      PieceType.PromotedLance,
      PieceType.PromotedKnight,
      PieceType.PromotedSilver,
      PieceType.Horse,
      PieceType.Dragon,
    ].includes(pieceType)
  ) {
    return 'none';
  }

  // 強制的に成る必要があるかの判定 (Must Promote)
  if (turn === 'sente') {
    if ((pieceType === PieceType.Pawn || pieceType === PieceType.Lance) && toY === 0) return 'must';
    if (pieceType === PieceType.Knight && toY <= 1) return 'must';
  } else {
    if ((pieceType === PieceType.Pawn || pieceType === PieceType.Lance) && toY === 8) return 'must';
    if (pieceType === PieceType.Knight && toY >= 7) return 'must';
  }

  // 成れるかどうかの判定 (Can Promote)
  const zone = turn === 'sente' ? SENTE_PROMOTION_ZONE : GOTE_PROMOTION_ZONE;
  const isEntering = zone.includes(toY);
  const isLeaving = zone.includes(fromY);

  if (isEntering || isLeaving) {
    return 'can';
  }

  return 'none';
};