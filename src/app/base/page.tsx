import { requireUser } from "@/lib/auth";
import { getBaseResume } from "@/lib/data";
import { EMPTY_RESUME } from "@/lib/types";
import { BaseEditor } from "./base-editor";

export default async function BasePage() {
  const user = await requireUser();
  const base = await getBaseResume(user.id);
  return <BaseEditor initial={base ?? { ...EMPTY_RESUME, contact: user.email }} isNew={!base} />;
}
