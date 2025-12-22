import React, { useState, useEffect, useRef } from 'react';

interface ChatProps {
  messages: { id: string, text: string, role: string, userName?: string, userId?: string, timestamp: number }[]; 
  onSendMessage: (text: string) => void;
  myRole: string;
  userId: string;
}

const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, myRole, userId }) => {
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input);
      setInput("");
    }
  };

  const getRoleLabel = (r: string) => {
      if (r === 'sente') return '先手';
      if (r === 'gote') return '後手';
      if (r === 'log') return '記録係'; // ログさんの肩書き
      return '観戦';
  };
  
  return (
    <div className="flex flex-col h-full bg-stone-900 border border-stone-700 rounded-lg overflow-hidden">
      <div className="bg-stone-800 p-2 border-b border-stone-700 text-stone-300 text-sm font-bold">
        チャット
      </div>
      
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-3">
        {messages.map((msg) => {
            const isSystem = msg.role === 'system';
            const isMe = msg.userId ? msg.userId === userId : msg.role === myRole;
            const isDebug = msg.text.startsWith('[DEBUG]');

            // ★修正: 入室ログ等のシステムメッセージを明るく (opacity-70 -> text-stone-400)
            if (isSystem) {
                return (
                    <div key={msg.id} className={`text-center text-xs py-1 ${isDebug ? 'text-red-400 font-bold' : 'text-stone-400'}`}>
                        {msg.text}
                    </div>
                );
            }

            // 吹き出しの色分け
            let bubbleClass = "bg-stone-800 text-stone-300 border border-stone-700"; // デフォルト（観戦者）
            if (msg.role === 'sente') {
                bubbleClass = "bg-amber-100 text-stone-900 border border-amber-200";
            } else if (msg.role === 'gote') {
                bubbleClass = "bg-stone-700 text-stone-100 border border-stone-600";
            } else if (msg.role === 'log') {
                // ★追加: ログさん用のスタイル（渋いグレー、少し強調）
                bubbleClass = "bg-stone-600 text-stone-200 border border-stone-500 font-mono text-xs";
            }

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`text-[10px] mb-0.5 flex gap-1 ${isMe ? 'text-stone-400' : 'text-stone-500'}`}>
                   <span className="font-bold">{msg.userName || "不明"}</span>
                   <span>({getRoleLabel(msg.role)})</span>
                </div>
                
                {/* ★修正: whitespace-pre-wrap で改行を有効化 */}
                <div className={`px-3 py-2 rounded max-w-[95%] text-sm break-words shadow-sm whitespace-pre-wrap ${bubbleClass}`}>
                  {msg.text}
                </div>
              </div>
            );
        })}
      </div>

      <form onSubmit={handleSubmit} className="p-2 bg-stone-800 border-t border-stone-700 flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-stone-900 border border-stone-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-600"
          placeholder="メッセージ..."
        />
        <button type="submit" className="bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded text-sm font-bold">送信</button>
      </form>
    </div>
  );
};

export default Chat;