import mammoth from "mammoth";
import { parseResumeFile } from "@/lib/ai";
import { userFromRequest } from "@/lib/data";

export const maxDuration = 120;

// Parses an uploaded PDF/DOCX into sections. Doesn't save — the editor does that.
export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "File is over 10 MB." }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".pdf")) {
      return Response.json(await parseResumeFile({ name: file.name, type: file.type, data }));
    }
    if (name.endsWith(".docx")) {
      const { value: text } = await mammoth.extractRawText({ buffer: data });
      return Response.json(await parseResumeFile({ name: file.name, type: file.type, data, text }));
    }
    return Response.json({ error: "Upload a PDF or DOCX." }, { status: 400 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't parse that file." }, { status: 500 });
  }
}
