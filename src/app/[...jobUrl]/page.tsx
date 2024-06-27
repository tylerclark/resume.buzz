"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import axios from "axios";

export default function JobRewrite() {
  const pathname = usePathname();
  const [jobUrl, setJobUrl] = useState<string | null>(null);
  const [rewrittenText, setRewrittenText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pathname) {
      const fullJobUrl = pathname.slice(1); // Remove the leading '/'
      console.log("fullJobUrl", fullJobUrl);
      setJobUrl(fullJobUrl);
    }
  }, [pathname]);

  useEffect(() => {
    if (jobUrl) {
      fetchJobDescription(jobUrl);
    }
  }, [jobUrl]);

  const fetchJobDescription = async (jobUrl: string) => {
    setLoading(true);
    try {
      // Call the API route to fetch and rewrite the job description
      const response = await axios.get(`/api/job?jobUrl=${encodeURIComponent(jobUrl)}`);
      const { rewrittenText, error } = response.data;

      if (error) {
        setError(error);
      } else {
        setRewrittenText(rewrittenText);
      }
    } catch (error: any) {
      setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Rewrite Resume</h1>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-500">{error}</p>}
      {rewrittenText && <pre className="whitespace-pre-wrap">{rewrittenText}</pre>}
    </div>
  );
}
