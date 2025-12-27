import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  addDoc,
  updateDoc,
  where,
  serverTimestamp,
  Timestamp 
} from 'firebase/firestore';
import AuthForm from '../components/AuthForm';

interface LobbyUser {
  uid: string;
  name: string;
  rate: number;
  status: 'waiting' | 'playing';
  lastSeen?: Timestamp; // 生存確認用の時刻
}

interface ChallengeData {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  roomId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: any;
}

const Lobby: React.FC = () => {
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [isAnalysis, setIsAnalysis] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [tab, setTab] = useState<'guest' | 'ranked'>('guest');

  const [waitingUsers, setWaitingUsers] = useState<LobbyUser[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  
  const [incomingChallenge, setIncomingChallenge] = useState<ChallengeData | null>(null);
  const [outgoingChallengeId, setOutgoingChallengeId] = useState<string | null>(null);

  const navigate = useNavigate();

  // 猶予時間は5分 (300,000ミリ秒)
  const GHOST_TIMEOUT = 5 * 60 * 1000;

  // 1. ログイン監視 & メール認証チェック
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.emailVerified) {
          setCurrentUser(user);
          setTab('ranked');
        } else {
          // 登録直後 (10秒以内) かどうかチェック
          const creationTime = new Date(user.metadata.creationTime || 0).getTime();
          const now = new Date().getTime();
          const isJustCreated = (now - creationTime) < 10000;

          if (isJustCreated) {
            await signOut(auth);
            setCurrentUser(null);
            setTab('guest');
          } else {
            alert("メール認証が完了していません。\n受信トレイを確認し、メール内のリンクをクリックしてから再度ログインしてください。");
            await signOut(auth);
            setCurrentUser(null);
            setTab('guest');
          }
        }
      } else {
        setCurrentUser(null);
        setTab('guest');
        setIsWaiting(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 待機ユーザーリストの監視 & ゴーストフィルタリング (5分ルール)
  useEffect(() => {
    const q = query(collection(db, "lobby"));
    
    // データ受信時の処理
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users: LobbyUser[] = [];
      const now = Date.now();

      snapshot.forEach((doc) => {
        const data = doc.data() as LobbyUser;
        
        // 最終更新から5分以上経過しているユーザーはリストに入れない
        let isActive = true;
        if (data.lastSeen) {
          const lastSeenMillis = data.lastSeen.toMillis();
          if (now - lastSeenMillis > GHOST_TIMEOUT) {
            isActive = false;
          }
        }

        if (isActive) {
          users.push(data);
        }
      });
      setWaitingUsers(users);

      // 自分がリストに含まれているか確認し、スイッチの状態を同期
      if (currentUser) {
        const amIInList = users.some(u => u.uid === currentUser.uid);
        
        // 「自分は待機中のはずなのに、DBから消えている(タイムアウトした)」場合
        if (isWaiting && !amIInList) {
            // ここではスイッチをOFFにして同期をとる
            // (ユーザーが戻ってきた瞬間に下記のHeartbeat処理で復活するため、ここは静かに同期するだけでOK)
            setIsWaiting(false);
        } else {
            setIsWaiting(amIInList);
        }
      }
    });

    // クライアント側でも定期的(30秒ごと)に時間をチェックして古い人を消す
    const intervalId = setInterval(() => {
      setWaitingUsers(prevUsers => {
        const now = Date.now();
        return prevUsers.filter(user => {
          if (!user.lastSeen) return true;
          return (now - user.lastSeen.toMillis() < GHOST_TIMEOUT);
        });
      });
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [currentUser, isWaiting]);

  // 3. 生存報告 (Heartbeat) & おかえり即時更新
  useEffect(() => {
    if (!currentUser || !isWaiting) return;

    // 生存報告を送る関数
    const sendHeartbeat = async () => {
      try {
        await updateDoc(doc(db, "lobby", currentUser.uid), {
          lastSeen: serverTimestamp()
        });
      } catch (e) {
        // もし時間が経ちすぎてドキュメントが消されていた場合、待機中なら再作成して復活させる
        if (isWaiting) {
             const myName = currentUser.displayName || currentUser.email?.split('@')[0] || "Unknown";
             try {
                await setDoc(doc(db, "lobby", currentUser.uid), {
                    uid: currentUser.uid,
                    name: myName,
                    rate: 1500,
                    status: 'waiting',
                    lastSeen: serverTimestamp()
                });
                console.log("タイムアウトから復帰しました");
             } catch(err) { console.error(err); }
        }
      }
    };

    // 1分ごとの定期更新
    const intervalId = setInterval(sendHeartbeat, 60000); 

    // ★重要: タブがアクティブになった(戻ってきた)瞬間に即座に更新
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            sendHeartbeat();
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
        clearInterval(intervalId);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser, isWaiting]);

  // 4. ブラウザを閉じる/リロード時の削除処理
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentUser && isWaiting) {
        // 閉じる直前に削除リクエストを投げる (成功は保証されないが、多くのケースで有効)
        deleteDoc(doc(db, "lobby", currentUser.uid)).catch(console.error);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentUser, isWaiting]);


  // 5. 挑戦関連の監視
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, "challenges"),
      where("toUid", "==", currentUser.uid),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const docData = snapshot.docs[0];
        setIncomingChallenge({ id: docData.id, ...docData.data() } as ChallengeData);
      } else {
        setIncomingChallenge(null);
      }
    });
    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!outgoingChallengeId) return;
    const unsubscribe = onSnapshot(doc(db, "challenges", outgoingChallengeId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as ChallengeData;
        if (data.status === 'accepted') {
          navigate(`/game/${data.roomId}?ranked=true`);
        } else if (data.status === 'rejected') {
          alert(`${data.toName} さんに挑戦を断られました。`);
          setOutgoingChallengeId(null);
          deleteDoc(doc(db, "challenges", outgoingChallengeId)).catch(console.error);
        }
      }
    });
    return () => unsubscribe();
  }, [outgoingChallengeId, navigate]);


  // --- 各種ハンドラ ---

  const handleGuestJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim() && userName.trim()) {
      const modeParam = isAnalysis ? '&mode=analysis' : '';
      navigate(`/game/${roomId}?name=${userName}${modeParam}`);
    }
  };

  const createRandomRoom = () => setRoomId(Math.random().toString(36).substring(2, 8));

  const handleLogout = async () => {
    if (currentUser && isWaiting) {
      try { await deleteDoc(doc(db, "lobby", currentUser.uid)); } catch (e) {}
    }
    signOut(auth);
  };

  const toggleWaiting = async () => {
    if (!currentUser) return;
    if (isWaiting) {
      try {
        await deleteDoc(doc(db, "lobby", currentUser.uid));
        setIsWaiting(false);
      } catch (err) {}
    } else {
      try {
        const myName = currentUser.displayName || currentUser.email?.split('@')[0] || "Unknown";
        const userData: LobbyUser = {
          uid: currentUser.uid,
          name: myName,
          rate: 1500,
          status: 'waiting',
          lastSeen: serverTimestamp() as Timestamp
        };
        await setDoc(doc(db, "lobby", currentUser.uid), userData);
        setIsWaiting(true);
      } catch (err) { alert("エラーが発生しました。"); }
    }
  };

  const handleChallenge = async (targetUser: LobbyUser) => {
    if (!currentUser || outgoingChallengeId) return;
    if (confirm(`${targetUser.name} (R${targetUser.rate}) さんに対局を申し込みますか？`)) {
        try {
            const newRoomId = Math.random().toString(36).substring(2, 8);
            const myName = currentUser.displayName || currentUser.email?.split('@')[0] || "Unknown";
            const docRef = await addDoc(collection(db, "challenges"), {
                fromUid: currentUser.uid,
                fromName: myName,
                toUid: targetUser.uid,
                toName: targetUser.name,
                roomId: newRoomId,
                status: 'pending',
                createdAt: serverTimestamp()
            });
            setOutgoingChallengeId(docRef.id);
        } catch (err) {
            console.error("挑戦エラー:", err);
            alert("申し込みに失敗しました");
        }
    }
  };

  const acceptChallenge = async () => {
    if (!incomingChallenge) return;
    try {
        await updateDoc(doc(db, "challenges", incomingChallenge.id), { status: 'accepted' });
        navigate(`/game/${incomingChallenge.roomId}?ranked=true`);
    } catch (err) { console.error(err); }
  };

  const rejectChallenge = async () => {
    if (!incomingChallenge) return;
    try {
        await updateDoc(doc(db, "challenges", incomingChallenge.id), { status: 'rejected' });
        setIncomingChallenge(null);
    } catch (err) { console.error(err); }
  };

  const cancelChallenge = async () => {
      if (!outgoingChallengeId) return;
      try {
          await deleteDoc(doc(db, "challenges", outgoingChallengeId));
          setOutgoingChallengeId(null);
      } catch (err) { console.error(err); }
  };

  return (
    <div className="min-h-screen bg-stone-900 flex flex-col items-center p-4 relative font-sans">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 p-4 bg-stone-800/50 rounded-lg border border-stone-700">
        <h1 className="text-2xl font-bold text-amber-100 font-serif">ShogiStack</h1>
        <div className="flex items-center gap-4">
          {currentUser ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm text-stone-200">{currentUser.displayName || currentUser.email?.split('@')[0]} さん</div>
                <div className="text-xs text-amber-500 font-mono">Rate: 1500</div>
              </div>
              <button onClick={handleLogout} className="text-xs text-stone-500 hover:text-stone-300 underline">ログアウト</button>
            </div>
          ) : (
            <button onClick={() => setShowAuthModal(true)} className="bg-amber-700 hover:bg-amber-600 text-white text-sm px-4 py-2 rounded shadow transition-colors">
              ログイン / 登録
            </button>
          )}
        </div>
      </header>

      <div className="w-full max-w-md">
        <div className="flex mb-4 border-b border-stone-700">
          <button onClick={() => setTab('guest')} className={`flex-1 pb-2 text-sm font-bold transition-colors ${tab === 'guest' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>合言葉対局 (ゲスト)</button>
          <button onClick={() => setTab('ranked')} className={`flex-1 pb-2 text-sm font-bold transition-colors ${tab === 'ranked' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'}`}>オンラインロビー</button>
        </div>

        <div className="bg-stone-800 p-6 rounded-lg shadow-xl border border-amber-700/30 min-h-[400px] relative">
          
          {tab === 'guest' && (
            <form onSubmit={handleGuestJoin} className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="text-center mb-6"><p className="text-stone-400 text-xs">会員登録なしで、友達とURLを共有して遊べます。</p></div>
              <div>
                <label className="block text-stone-400 text-xs mb-1">ユーザー名</label>
                <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-3 text-white focus:border-amber-500 outline-none" placeholder="あなたの名前" required />
              </div>
              <div>
                <label className="block text-stone-400 text-xs mb-1">ルームID (合言葉)</label>
                <div className="flex gap-2">
                    <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-full bg-stone-900 border border-stone-600 rounded px-3 py-3 text-white focus:border-amber-500 outline-none font-mono" placeholder="shogi-room" required />
                    <button type="button" onClick={createRandomRoom} className="bg-stone-700 text-stone-300 px-3 rounded hover:bg-stone-600 text-xs whitespace-nowrap">自動</button>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-stone-900/50 rounded border border-stone-700">
                 <input type="checkbox" id="analysisMode" checked={isAnalysis} onChange={(e) => setIsAnalysis(e.target.checked)} className="w-4 h-4 accent-amber-600 cursor-pointer" />
                 <label htmlFor="analysisMode" className="text-stone-300 text-xs cursor-pointer select-none">検討モード (一人用)</label>
              </div>
              <button type="submit" className="w-full bg-stone-700 hover:bg-stone-600 text-white font-bold py-3 rounded shadow-lg transition-all">入室する</button>
            </form>
          )}

          {tab === 'ranked' && (
            <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2 duration-300">
              {!currentUser ? (
                <div className="py-10 text-center">
                  <p className="text-stone-400 text-sm mb-4">ロビーに入室するには<br/>ログインが必要です</p>
                  <button onClick={() => setShowAuthModal(true)} className="bg-amber-700 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded shadow">ログインする</button>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex justify-between items-center">
                    <h3 className="text-amber-100 font-bold">対局待機者リスト</h3>
                    <div className="text-xs text-stone-400">{waitingUsers.length} 人が待機中</div>
                  </div>
                  
                  <div className="flex-1 bg-stone-900/50 rounded border border-stone-700 overflow-y-auto max-h-[250px] mb-4 p-2 space-y-2">
                    {waitingUsers.map((user) => (
                      <div key={user.uid} className={`flex justify-between items-center p-3 rounded border transition-colors ${user.uid === currentUser.uid ? 'bg-amber-900/20 border-amber-800' : 'bg-stone-800 border-stone-700'}`}>
                        <div>
                          <div className="text-stone-200 text-sm font-bold">
                            {user.name}
                            {user.uid === currentUser.uid && <span className="text-amber-500 text-[10px] ml-2">(あなた)</span>}
                          </div>
                          <div className="text-xs text-stone-500">Rate: {user.rate}</div>
                        </div>
                        {user.uid !== currentUser.uid && (
                          <button 
                             onClick={() => handleChallenge(user)}
                             disabled={!!outgoingChallengeId} 
                             className={`text-white text-xs px-3 py-1.5 rounded transition-colors ${
                               outgoingChallengeId 
                               ? 'bg-stone-700 cursor-not-allowed text-stone-500' 
                               : 'bg-amber-700 hover:bg-amber-600'
                             }`}
                           >
                             挑戦する
                           </button>
                        )}
                      </div>
                    ))}
                    {waitingUsers.length === 0 && (
                      <div className="text-center text-stone-500 text-xs py-10">待機中のユーザーはいません</div>
                    )}
                  </div>

                  <div className="mt-auto">
                    <button 
                      onClick={toggleWaiting}
                      className={`w-full font-bold py-3 rounded shadow-lg transition-all ${
                        isWaiting 
                          ? "bg-red-900/80 text-red-200 border border-red-700 hover:bg-red-900" 
                          : "bg-amber-700 hover:bg-amber-600 text-white"
                      }`}
                    >
                      {isWaiting ? "待機をキャンセル" : "対局待ちを開始する"}
                    </button>
                    <p className="text-[10px] text-stone-500 text-center mt-2">
                      {isWaiting ? "ボタンを押すとリストから削除されます" : "ボタンを押すとロビーに表示されます"}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 受信した挑戦状モーダル */}
          {incomingChallenge && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20 rounded-lg animate-in fade-in zoom-in duration-200">
                <div className="text-amber-100 font-bold mb-2 text-lg">挑戦者が現れました！</div>
                <div className="text-stone-300 mb-6 text-sm">
                    <span className="text-amber-400 font-bold text-base">{incomingChallenge.fromName}</span> さんから<br/>
                    対局の申し込みです
                </div>
                <div className="flex gap-4">
                    <button 
                        onClick={rejectChallenge}
                        className="bg-stone-700 hover:bg-stone-600 text-white px-6 py-2 rounded font-bold"
                    >
                        拒否
                    </button>
                    <button 
                        onClick={acceptChallenge}
                        className="bg-amber-700 hover:bg-amber-600 text-white px-6 py-2 rounded font-bold shadow-lg shadow-amber-900/50"
                    >
                        受諾して対局
                    </button>
                </div>
            </div>
          )}

          {/* 送信中の挑戦状モーダル */}
          {outgoingChallengeId && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20 rounded-lg animate-in fade-in duration-200">
                  <div className="text-stone-300 font-bold mb-4 animate-pulse">相手の応答を待っています...</div>
                  <button 
                      onClick={cancelChallenge}
                      className="text-stone-500 hover:text-stone-300 text-xs underline"
                  >
                      キャンセル
                  </button>
              </div>
          )}

        </div>
      </div>
      {showAuthModal && <AuthForm onClose={() => setShowAuthModal(false)} />}
    </div>
  );
};

export default Lobby;