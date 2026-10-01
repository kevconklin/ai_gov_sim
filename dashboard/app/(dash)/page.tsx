import { redirect } from "next/navigation";

/** Reviews are what this application is for, so they are where it opens. */
export default function Home() {
  redirect("/reviews");
}
