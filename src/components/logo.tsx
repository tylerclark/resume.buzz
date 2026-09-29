import Image from "next/image";
import logo from "../../public/logo.png";
import logoDark from "../../public/logo-dark.png";
import logoVertical from "../../public/logo_v.png";
import logoVerticalDark from "../../public/logo_v-dark.png";

// "wordmark" (logo.png) is the wide header logo, trimmed to the artwork so `height` is the visible mark
// height. "stacked" (logo_v.png) is the icon-over-wordmark version for the login page; it has built-in
// padding, so give it more height than you'd think.
// The *-dark files are the same artwork with the navy wordmark recolored to near-white; the pair is
// swapped with CSS so it follows the theme class, not just the OS setting.
export function Logo({
  height = 24,
  priority,
  variant = "wordmark",
}: {
  height?: number;
  priority?: boolean;
  variant?: "wordmark" | "stacked";
}) {
  const stacked = variant === "stacked";
  return (
    <>
      <Image
        src={stacked ? logoVertical : logo}
        alt="resume.buzz"
        priority={priority}
        style={{ height, width: "auto" }}
        className="block select-none dark:hidden"
      />
      <Image
        src={stacked ? logoVerticalDark : logoDark}
        alt="resume.buzz"
        priority={priority}
        style={{ height, width: "auto" }}
        className="hidden select-none dark:block"
      />
    </>
  );
}
