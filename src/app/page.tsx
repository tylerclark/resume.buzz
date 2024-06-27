"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation"; // Import from next/navigation for use in client components
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    // Extract tokens from the URL hash
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        // Store the tokens in Supabase
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        setIsLoggedIn(true);
        window.location.hash = ""; // Clear the hash from the URL
        router.push("/dashboard"); // Redirect to a different page
      }
    }
  }, [router]);

  const handleLogin = async () => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    setMessage(data.message || data.error);
  };

  return (
    <div className="container mx-auto p-4">
      {!isLoggedIn ? (
        <>
          <h1 className="text-2xl font-bold mb-4">Login</h1>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="border p-2 mb-4 w-full bg-white text-black dark:bg-gray-800 dark:text-white"
          />
          <button onClick={handleLogin} className="bg-blue-500 text-white p-2 rounded">
            Send OTP
          </button>
          {message && <p className="mt-4">{message}</p>}
        </>
      ) : (
        <p>Welcome! You are now logged in.</p>
      )}
    </div>
  );
}
