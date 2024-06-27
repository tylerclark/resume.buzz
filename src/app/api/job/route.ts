// src/app/api/job/route.ts
import axios from "axios";
import OpenAI from "openai";
import { JSDOM } from "jsdom";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobUrl = searchParams.get("jobUrl")?.replace("https:/", "https://");

  console.log("jobUrl", jobUrl);

  if (!jobUrl) {
    return NextResponse.json({ error: "Job URL is required" }, { status: 400 });
  }

  try {
    // Ensure jobUrl starts with 'http' or 'https'
    const formattedJobUrl = jobUrl.startsWith("http") ? jobUrl : `https://${jobUrl}`;

    // Fetch the job listing page
    const response = await axios.get(formattedJobUrl);
    const html = response.data;

    // Use JSDOM to parse the HTML and extract the job description
    const dom = new JSDOM(html);
    const jobDescription = dom.window.document.body.textContent || "";
    // const jobDescription = dom.window.document.querySelector(".job-description-selector")?.textContent || "";

    if (!jobDescription) {
      return NextResponse.json({ error: "Job description not found" }, { status: 400 });
    }

    // Use OpenAI to rewrite the job description for the resume
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "user", content: `Rewrite the following job description to match a resume:\n\n${jobDescription}` },
      ],
      max_tokens: 1000,
    });

    return NextResponse.json({ rewrittenText: aiResponse.choices[0].message.content }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
