import React, { useState } from 'react';
import { auth, db } from '../firebase'; // db を追加インポート
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendEmailVerification, 
  signOut,
  updateProfile 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  setDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore'; // Firestore機能をインポート

interface AuthFormProps {
  onClose: () => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  
  // 入力フォームの状態管理
  const [loginInput, setLoginInput] = useState(""); // ログイン用（メアド or ユーザー名）
  const [regEmail, setRegEmail] = useState("");     // 登録用メアド
  const [regUsername, setRegUsername] = useState(""); // 登録用ユーザー名
  const [password, setPassword] = useState("");
  
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isLogin) {
        // --- ログイン処理 ---
        let emailToLogin = loginInput;

        // 入力値がメールアドレス形式（@を含む）でない場合、ユーザー名とみなしてDB検索
        if (!loginInput.includes('@')) {
            const q = query(collection(db, "users"), where("username", "==", loginInput));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                throw new Error("USER_NOT_FOUND");
            }
            // 見つかったら、そのユーザーのメールアドレスを取得してログインに使う
            emailToLogin = querySnapshot.docs[0].data().email;
        }

        await signInWithEmailAndPassword(auth, emailToLogin, password);
        onClose();

      } else {
        // --- 新規登録処理 ---
        // ★追加: ユーザー名の文字種チェック
        // 半角英数字(a-z, A-Z, 0-9)、ハイフン(-)、アンダースコア(_) のみ許可
        const usernameRegex = /^[a-zA-Z0-9-_]+$/;
        if (!usernameRegex.test(regUsername)) {
            throw new Error("INVALID_USERNAME_FORMAT");
        }
        
        // 1. ユーザー名の重複チェック
        const q = query(collection(db, "users"), where("username", "==", regUsername));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            throw new Error("USERNAME_TAKEN");
        }

        // 2. アカウント作成
        const userCredential = await createUserWithEmailAndPassword(auth, regEmail, password);
        const user = userCredential.user;

        // 3. プロフィール更新（Auth側）
        await updateProfile(user, { displayName: regUsername });

        // 4. データベースにユーザー情報を保存（重要！）
        // これがあるから次回以降「ユーザー名ログイン」ができるようになります
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            username: regUsername,
            email: regEmail,
            createdAt: serverTimestamp()
        });

        // 5. 確認メール送信
        await sendEmailVerification(user);

        // 6. 一度ログアウト
        await signOut(auth);
        
        alert("認証メールを送信しました。\nメール内のリンクをクリックして登録を完了させてください。");
        onClose();
      }
    } catch (err: any) {
      console.error(err);
      // エラーメッセージの分岐
      if (err.message === "USER_NOT_FOUND") {
          setError("ユーザーが見つかりませんでした。");
      } else if (err.message === "USERNAME_TAKEN") {
          setError("そのユーザー名は既に使用されています。");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("そのメールアドレスは既に使用されています。");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === "auth/invalid-credential") {
        setError("メールアドレス（またはユーザー名）かパスワードが間違っています。");
      } else if (err.code === 'auth/weak-password') {
        setError("パスワードは6文字以上で設定してください。");
      } else {
        setError("エラーが発生しました。もう一度お試しください。");
      }
    } finally {
        setIsLoading(false);
    }
  };

  // モード切替時にフォームをクリア
  const toggleMode = () => {
      setIsLogin(!isLogin);
      setError("");
      setLoginInput("");
      setRegEmail("");
      setRegUsername("");
      setPassword("");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-stone-800 p-6 rounded-lg shadow-2xl border border-stone-600 w-full max-w-sm relative animate-in fade-in zoom-in duration-200">
        <button onClick={onClose} className="absolute top-2 right-2 text-stone-400 hover:text-white">✕</button>
        
        <h2 className="text-xl font-bold text-amber-100 mb-4 text-center">
          {isLogin ? "ログイン" : "新規会員登録"}
        </h2>

        {error && <div className="bg-red-900/50 text-red-200 text-xs p-2 rounded mb-4 border border-red-800">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {isLogin ? (
            /* ログイン時: メアド or ユーザー名 */
            <div>
                <label className="block text-stone-400 text-xs mb-1">メールアドレス または ユーザー名</label>
                <input 
                type="text" 
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
                required
                />
            </div>
          ) : (
            /* 登録時: ユーザー名とメアドを別々に入力 */
            <>
                <div>
                    <label className="block text-stone-400 text-xs mb-1">ユーザー名 <span className="text-[10px] text-stone-500">(対局名・ログインIDになります)</span></label>
                    <input 
                    type="text" 
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
                    placeholder="例: shogi_taro"
                    required
                    />
                </div>
                <div>
                    <label className="block text-stone-400 text-xs mb-1">メールアドレス</label>
                    <input 
                    type="email" 
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
                    required
                    />
                </div>
            </>
          )}

          <div>
            <label className="block text-stone-400 text-xs mb-1">パスワード</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
              required
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className={`w-full font-bold py-2 rounded transition-colors ${isLoading ? 'bg-stone-600 text-stone-400 cursor-not-allowed' : 'bg-amber-700 hover:bg-amber-600 text-white'}`}
          >
            {isLoading ? "処理中..." : (isLogin ? "ログインする" : "登録して確認メールを送る")}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button 
            onClick={toggleMode} 
            className="text-stone-500 text-xs hover:text-amber-400 underline"
          >
            {isLogin ? "アカウントをお持ちでない方はこちら" : "すでにアカウントをお持ちの方はこちら"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthForm;