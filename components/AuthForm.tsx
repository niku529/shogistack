import React, { useState } from 'react';
import { auth, db } from '../firebase';
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
} from 'firebase/firestore';

interface AuthFormProps {
  onClose: () => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  
  const [loginInput, setLoginInput] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [password, setPassword] = useState("");
  
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isLogin) {
        let emailToLogin = loginInput;
        if (!loginInput.includes('@')) {
            const q = query(collection(db, "users"), where("username", "==", loginInput));
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                throw new Error("USER_NOT_FOUND");
            }
            emailToLogin = querySnapshot.docs[0].data().email;
        }
        await signInWithEmailAndPassword(auth, emailToLogin, password);
        onClose();
      } else {
        const usernameRegex = /^[a-zA-Z0-9-_]+$/;
        if (!usernameRegex.test(regUsername)) {
            throw new Error("INVALID_USERNAME_FORMAT");
        }
        
        const q = query(collection(db, "users"), where("username", "==", regUsername));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            throw new Error("USERNAME_TAKEN");
        }

        const userCredential = await createUserWithEmailAndPassword(auth, regEmail, password);
        const user = userCredential.user;

        await updateProfile(user, { displayName: regUsername });

        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            username: regUsername,
            email: regEmail,
            createdAt: serverTimestamp()
        });

        await sendEmailVerification(user);
        await signOut(auth);
        
        alert("認証メールを送信しました。\nメール内のリンクをクリックして登録を完了させてください。");
        onClose();
      }
    } catch (err: any) {
      console.error(err);
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
            <div>
                {/* ★修正: idとhtmlForを追加 */}
                <label htmlFor="loginId" className="block text-stone-400 text-xs mb-1">メールアドレス または ユーザー名</label>
                <input 
                  id="loginId"
                  name="loginId"
                  type="text" 
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
                  required
                />
            </div>
          ) : (
            <>
                <div>
                    {/* ★修正: idとhtmlForを追加 */}
                    <label htmlFor="regUsername" className="block text-stone-400 text-xs mb-1">ユーザー名 <span className="text-[10px] text-stone-500">(対局名・ログインIDになります)</span></label>
                    <input 
                      id="regUsername"
                      name="username"
                      type="text" 
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      className="w-full bg-stone-900 border border-stone-600 rounded p-2 text-white focus:border-amber-500 outline-none"
                      placeholder="例: shogi_taro"
                      required
                    />
                </div>
                <div>
                    {/* ★修正: idとhtmlForを追加 */}
                    <label htmlFor="regEmail" className="block text-stone-400 text-xs mb-1">メールアドレス</label>
                    <input 
                      id="regEmail"
                      name="email"
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
            {/* ★修正: idとhtmlForを追加 */}
            <label htmlFor="password" className="block text-stone-400 text-xs mb-1">パスワード</label>
            <input 
              id="password"
              name="password"
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