import Link from "next/link";
import { Icon } from "../reviews/parts";

interface Section {
  id: string;
  title: string;
  lead: string;
  steps: string[];
  image: string;
  alt: string;
  tryIt: { href: string; label: string };
}

/**
 * How the product is used, in the order a new organization meets it. Each section is a few numbered steps and
 * one picture of the real screen; the pictures live in public/how-to and are retaken when a screen changes.
 */
const SECTIONS: Section[] = [
  {
    id: "organizations",
    title: "See every organization at a glance",
    lead: "Organizations is the front page. Each row is one committee, with what it needs from a person right now.",
    steps: [
      "A blue chip means a decision is waiting for your signature. Amber means matters are waiting for review, or the policy could not answer a question.",
      "The four tiles add it all up across every organization.",
      "Click a row to open that organization's Reviews page.",
    ],
    image: "organizations", alt: "The Organizations page listing each committee with decisions to sign, matters waiting, and spend",
    tryIt: { href: "/organizations", label: "Open Organizations" },
  },
  {
    id: "setup",
    title: "Set up an organization in five minutes",
    lead: "New organization asks plain questions and builds the governance from the answers. Nothing is final until you press Create.",
    steps: [
      "About you: the name, what it does, how many people, where it operates, and whether a regulator reviews it.",
      "Your goals: pick up to three, say how bold leadership is, and whether AI already helps decide things about people.",
      "AI today: list the tools people already use, one per line. Each becomes a matter for the committee.",
      "Your setup: the starter policy, framework, and how careful the committee is, each with the reason it was chosen. Change anything, then Create.",
    ],
    image: "setup-4", alt: "The last step of setup, showing the chosen starter kit, framework, and stance with reasons",
    tryIt: { href: "/reviews?open=customer", label: "Set one up" },
  },
  {
    id: "submit",
    title: "Bring a matter to the committee",
    lead: "Submit a matter never asks you to know the vocabulary. Answer what you need, and it says how it will be filed and why.",
    steps: [
      "Say what you need: use a tool, build something, report a problem, ask a question, or change the policy.",
      "Name it and describe it in your own words.",
      "Answer where it comes from, who it touches, what information it sees, and whether it helps decide about a person.",
      "Read the Filed as box. If it is wrong, open Not right? and set the kind or risk yourself.",
      "Tick an earlier decision it relates to, so the committee reads that decision as precedent.",
    ],
    image: "submit", alt: "The Submit a matter form with plain questions and a Filed as box showing AI vendor, High risk",
    tryIt: { href: "/reviews?open=submit", label: "Submit a matter" },
  },
  {
    id: "convene",
    title: "Convene a review",
    lead: "Nothing is reviewed until a person says so. Waiting lists the matters, ranked most urgent first.",
    steps: [
      "Open Waiting. Tick the matters you want reviewed together.",
      "Press Convene a review. The right seats sit for each kind of matter; high risk seats the whole committee.",
      "A live review takes a few minutes: each adviser writes a sealed position, they debate, then vote by secret ballot.",
      "When it finishes, the recommendation appears under Needs you.",
    ],
    image: "waiting", alt: "The Waiting tab with two matters ticked and the Convene a review button",
    tryIt: { href: "/reviews?tab=waiting", label: "Open Waiting" },
  },
  {
    id: "decide",
    title: "Read the recommendation and decide",
    lead: "The committee only recommends. The decision page puts what you need to know first.",
    steps: [
      "The first line says what the committee recommends and how firmly: unanimous, a clear majority, or split.",
      "Why gives the majority's reason in one adviser's words. Strongest objection gives the dissent in the objector's.",
      "What signing does tells you when it takes effect and that your name goes on the record.",
      "Tick each objection once you have weighed it. On high-risk matters you must.",
      "Choose Approve, Reject, or Send back, write your reasoning in your own words, and Sign. Deciding against the recommendation is allowed and recorded as an overrule.",
      "Send back when you need more: your note is what the committee reads first next time, with what it recommended this time. Tick Convene now to start that review at once.",
    ],
    image: "decide", alt: "A decision page with the brief at the top and the signing form beneath",
    tryIt: { href: "/reviews?tab=needs", label: "Open Needs you" },
  },
  {
    id: "usecases",
    title: "Follow a use case through its life",
    lead: "Approval is a beginning. Use cases shows every one from proposal to retirement, who owns it, and when it is due back.",
    steps: [
      "Propose a use case: what you want to do, who it affects, what it sees, and who is accountable for it.",
      "When a person signs an approval, its life starts: Approved, with an owner and a review date set by its risk (6, 12, or 24 months).",
      "Move it as work happens: Building, Piloting, Live, Paused, Retired. Each move needs a note and goes on the record.",
      "When its review date passes, the next ranking of Waiting opens a re-review that cites the original decision. Approve to renew it; reject to pause it.",
    ],
    image: "usecases", alt: "The Use cases page with tiles for live, building, overdue, and lists by stage",
    tryIt: { href: "/portfolio", label: "Open Use cases" },
  },
  {
    id: "trail",
    title: "See how the committee got there",
    lead: "Every review keeps its full trail, recorded as it happened.",
    steps: [
      "On a decision, open How each seat voted, then See how the committee got here.",
      "Read it top down: who convened it, who sat, the sealed views written before anyone spoke, the debate, the ballot, the minutes, and your decision.",
      "Open any step for the words themselves.",
    ],
    image: "trail", alt: "The trail of a review: convened, panel seated, sealed views, debate, secret ballot, minutes, your decision",
    tryIt: { href: "/reviews?tab=reviews", label: "Open Reviews" },
  },
  {
    id: "ask",
    title: "Ask the policy a question",
    lead: "Most questions have an answer in the policy already. Ask reads it for you and cites the control it relied on.",
    steps: [
      "Type the question the way you would ask a colleague.",
      "The answer arrives in a few seconds with the controls it relied on as chips; click one to read it in the policy.",
      "If the policy does not cover it, the answer says so. Press Send to the committee and it joins Waiting as a question.",
      "Reviews shows a banner while there are gaps the committee has not heard.",
    ],
    image: "ask", alt: "The Ask page with questions answered from the policy and one marked not covered",
    tryIt: { href: "/ask", label: "Ask something" },
  },
  {
    id: "approved",
    title: "Check what is allowed",
    lead: "Approved tools is written from signed decisions only. Staff type a name and get the answer in one line.",
    steps: [
      "You may use these: approved by a named person, with the conditions in their words. Stay inside them.",
      "Not allowed: refused, with the reason.",
      "Being looked at: submitted and not yet decided. Nothing is approved until it moves up.",
      "Not there at all? Submit it, or ask the policy what applies meanwhile.",
    ],
    image: "approved", alt: "The Approved tools page with a search box and three lists: allowed, not allowed, being looked at",
    tryIt: { href: "/approved", label: "Open Approved tools" },
  },
  {
    id: "policy",
    title: "Keep the policy",
    lead: "Policy shows the controls in force, one per row, and every version there has been.",
    steps: [
      "Each control carries its number and the framework clause it serves.",
      "Open a version to see what changed and compare it with the one before.",
      "To change the policy, press Propose a change. It goes through a review like anything else, and takes effect when you sign.",
    ],
    image: "policy", alt: "The Policy page listing numbered controls with framework clauses",
    tryIt: { href: "/policy-record", label: "Read the policy" },
  },
  {
    id: "committee",
    title: "Shape the committee",
    lead: "Each seat is an AI adviser with a brief: what it argues for, and what it is blind to. You can change all of it.",
    steps: [
      "Committee lists the seats. Open one to rewrite its brief, change its model, or remove it. Add a seat for a view you are missing.",
      "Settings holds what the committee is told about the organization, the governing documents it can cite, which seats review which kind of matter, and the monthly budget.",
      "Every change asks why. It lands under Changes with your name, and cannot be edited or removed.",
      "Status lets you archive an organization. Nothing is deleted, and it can be restored.",
    ],
    image: "committee", alt: "The Committee tab listing eight seats with their titles and models",
    tryIt: { href: "/reviews?tab=committee", label: "Open Committee" },
  },
  {
    id: "people",
    title: "Add people and decide who may do what",
    lead: "Every action is under a real account. Three roles per organization: runs it, decides, asks and submits.",
    steps: [
      "Settings, People, Add person: their name, email, what they may do, and why.",
      "A new email gets an account with a temporary password, shown to you once. Hand it over; they choose their own at first sign-in.",
      "Someone who asks can submit matters, ask the policy, and read everything. Someone who decides can also convene and sign. Someone who runs it can also change settings, the committee, documents, budget, and people.",
      "A person sees only the organizations they belong to. Operators, who run the whole service, see all of them and are listed on Organizations.",
      "Your name and email go on everything you sign; change either under your account, bottom left.",
    ],
    image: "people", alt: "The People group in Settings with members and their roles",
    tryIt: { href: "/reviews?tab=settings", label: "Open Settings" },
  },
  {
    id: "spend",
    title: "Watch spend and health",
    lead: "Every review and every question is a model call, counted against a monthly cap you set.",
    steps: [
      "Spend & health shows this month against the cap, calls by model, and month by month.",
      "Reviews are refused once the cap is spent, until you raise it or the month ends.",
      "Anything that failed or needed a retry is listed, with a link to its full record in Logs.",
    ],
    image: "spend", alt: "The Spend and health page with the month's spend against the cap and calls by model",
    tryIt: { href: "/spend", label: "Open Spend & health" },
  },
];

export default function HowToPage() {
  return (
    <div className="rv rv-howto">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">How to</h1></div>
      </header>
      <p className="rv-howto-lead">The whole product in ten short pages, in the order a new organization meets it. Every picture is the real screen.</p>

      <nav className="rv-howto-toc" aria-label="Sections">
        {SECTIONS.map((s, i) => <a key={s.id} href={`#${s.id}`} className="rv-tick"><span className="rv-step-n">{i + 1}</span><span>{s.title}</span></a>)}
      </nav>

      {SECTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="rv-card rv-howto-section">
          <div className="rv-howto-text">
            <h2 className="rv-howto-h"><span className="rv-step-n">{i + 1}</span>{s.title}</h2>
            <p className="rv-howto-p">{s.lead}</p>
            <ol className="rv-howto-steps">{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <Link href={s.tryIt.href} className="rv-btn rv-btn-sm w-fit">{s.tryIt.label} <Icon name="chevron" /></Link>
          </div>
          <a href={`/how-to/${s.image}.png`} target="_blank" rel="noreferrer" className="rv-howto-shot" title="Open the picture full size">
            <img src={`/how-to/${s.image}.png`} alt={s.alt} loading="lazy" width={1200} height={820} />
          </a>
        </section>
      ))}
    </div>
  );
}
