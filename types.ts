// src/types.ts

export type Player = 'sente' | 'gote';

export enum PieceType {
  Pawn = 'Pawn',
  Lance = 'Lance',
  Knight = 'Knight',
  Silver = 'Silver',
  Gold = 'Gold',
  Bishop = 'Bishop',
  Rook = 'Rook',
  King = 'King',
  PromotedPawn = 'PromotedPawn',
  PromotedLance = 'PromotedLance',
  PromotedKnight = 'PromotedKnight',
  PromotedSilver = 'PromotedSilver',
  Horse = 'Horse',
  Dragon = 'Dragon'
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface Piece {
  type: PieceType;
  owner: Player;
  isPromoted: boolean;
}

export type BoardState = (Piece | null)[][];

export type Hand = Record<PieceType, number>;

// ★追加: 時間情報の型
export interface MoveTime {
  now: number;   // その一手にかかった時間(秒)
  total: number; // 通算消費時間(秒)
}

export interface Move {
  from: Coordinates | 'hand';
  to: Coordinates;
  piece: PieceType;
  drop: boolean;
  isPromoted: boolean;
  isCheck?: boolean; // 王手フラグ
  time?: MoveTime;   // ★追加: 時間情報
}