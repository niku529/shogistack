import React from 'react';
import { Hand, PieceType, Player } from '../types';
import { PIECE_KANJI } from '../constants';

interface KomadaiProps {
  hand: Hand;
  owner: Player;
  isCurrentTurn: boolean;
  onSelectPiece: (piece: PieceType) => void;
  selectedPiece: PieceType | null;
}

// 表示順序（飛車角金銀桂香歩）
const ORDER = [
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Gold,
  PieceType.Silver,
  PieceType.Knight,
  PieceType.Lance,
  PieceType.Pawn,
];

const Komadai: React.FC<KomadaiProps> = ({ hand, owner, isCurrentTurn, onSelectPiece, selectedPiece }) => {
  // ★修正点: 将棋の駒らしい末広がりの五角形
  // 頂点(50% 0%), 右肩(85% 25%), 右下(95% 100%), 左下(5% 100%), 左肩(15% 25%)
  const pieceShape = "polygon(50% 0%, 85% 25%, 95% 100%, 5% 100%, 15% 25%)";

  return (
    <div className={`
      w-full px-3 py-2 rounded-md shadow-inner min-h-[70px] flex items-center
      bg-[#d4a373] border-t-2 border-b-4 border-x-2 border-[#a67c52]
      transition-all duration-300
      ${isCurrentTurn ? 'ring-2 ring-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'opacity-90'}
    `}>
      <div className="flex flex-wrap gap-1 justify-start items-center w-full">
        {ORDER.map((type) => {
          const count = hand[type];
          if (count === 0) return null;

          return (
            <div 
              key={type}
              onClick={() => onSelectPiece(type)}
              className={`
                relative cursor-pointer select-none group
                flex items-center justify-center
                transition-transform active:scale-95
                ${selectedPiece === type ? '-translate-y-1' : 'hover:-translate-y-0.5'}
              `}
              style={{ width: '38px', height: '42px' }} // 少しだけ大きくして形を見やすく
            >
              {/* 駒の本体 */}
              <div 
                className={`
                  absolute inset-0 flex items-end justify-center pb-1
                  bg-[#f3d398] text-stone-900 font-serif font-bold text-lg leading-none
                  shadow-[1px_2px_3px_rgba(0,0,0,0.3)]
                  bg-gradient-to-b from-[#f3d398] to-[#e0b87e] // 少しグラデーションを入れて立体感を出す
                  ${selectedPiece === type ? 'bg-[#ffebc2] from-[#ffebc2] to-[#ffdca0] text-black' : ''}
                `}
                style={{
                  clipPath: pieceShape, // ★修正した形を適用
                }}
              >
                <span className="mb-0.5">{PIECE_KANJI[type]}</span>
              </div>
              
              {/* 影用ダミー */}
              <div 
                className="absolute inset-0 bg-black/20 -z-10 translate-y-0.5"
                style={{ 
                  clipPath: pieceShape // ★影も同じ形にする
                }}
              />

              {/* 枚数バッジ */}
              {count > 1 && (
                <div className="absolute -top-1 -right-0.5 bg-red-700 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shadow-md border border-white z-20">
                  {count}
                </div>
              )}
            </div>
          );
        })}
        
        {/* 持ち駒がない場合 */}
        {Object.values(hand).every(c => c === 0) && (
          <div className="text-[#8c6b4a] text-xs font-bold opacity-60 w-full text-center tracking-widest">
            なし
          </div>
        )}
      </div>
    </div>
  );
};

export default Komadai;