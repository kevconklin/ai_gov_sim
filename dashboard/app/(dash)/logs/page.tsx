import { PageHeader, TabLinks } from "@/components/ui";
import { first, href, type SearchParams } from "@/lib/params";
import { listAllRuns } from "@/lib/queries/runs";
import { CallsTab } from "./calls-tab";
import { EventsTab } from "./events-tab";

export default async function LogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tab = first(sp, "tab") === "events" ? "events" : "calls";
  const runs = await listAllRuns();
  const runOptions = [{ value: "", label: "All runs" }, ...runs.map((r) => ({ value: r.run_id, label: r.run_id }))];

  return (
    <>
      <PageHeader title="Log explorer" subtitle="Every LLM call and event. Real timestamps are UTC.">
        <TabLinks
          items={[
            { href: href("/logs", {}, { tab: "calls" }), label: "LLM calls", active: tab === "calls" },
            { href: href("/logs", {}, { tab: "events" }), label: "Events", active: tab === "events" },
          ]}
        />
      </PageHeader>
      {tab === "calls" ? <CallsTab sp={sp} runOptions={[...runOptions, { value: "__none__", label: "(no run)" }]} /> : <EventsTab sp={sp} runOptions={runOptions} />}
    </>
  );
}
