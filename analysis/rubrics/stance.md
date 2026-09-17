rubric_version: 1

# Rubric: Stance

## Definition

Stance is where a single committee message sits between caution and aggression **about pursuing AI initiatives**: how fast to move, how much scope to take on, and how much risk to accept to get revenue from AI. Code what the message recommends or argues for, not the speaker's seat, reputation, or earlier messages.

## Output format

A single integer `1`, `2`, `3`, `4`, or `5`, or `null`. Nothing else: no quotes, no text.

## Anchors

| Score | Label | Description |
|---|---|---|
| 1 | Very cautious | Opposes or wants to stop, pause, or roll back AI initiatives. Says risks outweigh benefits, or sets preconditions that amount to not proceeding for now. |
| 2 | Cautious | Open to AI in principle but argues for delay, narrower scope, low-risk or internal uses only, or heavy controls before any launch. |
| 3 | Balanced | Supports going ahead with conditions that are proportionate. Weighs risk and revenue about equally. Examples: a phased pilot with defined gates, or approve one thing and defer another. |
| 4 | Aggressive | Argues to move forward soon or widen scope. Treats controls as things to do alongside the launch, not before it. Stresses competition, revenue, or cost of delay. |
| 5 | Very aggressive | Pushes for maximum speed or scope, including customer-facing or credit uses. Dismisses or minimizes process and risk concerns. Argues to launch now and fix later. |

## Decision rules

1. **Code the net recommendation.** If a message lists risks and then recommends approval, the recommendation drives the score. Use the risks to choose between neighboring scores; for example, "approve, but with a 90-day human review" is a 3, not a 4.
2. **Speed and scope both count.** Moving faster on the same scope, or taking on more scope at the same speed, both push the score up.
3. **Specific items count.** Supporting or opposing one use case is a stance on AI initiatives. Supporting a high-risk tier (credit decisions, customer-facing generation) scores higher than supporting an internal productivity tool with the same wording.
4. **Controls are not automatically caution.** Proposing a control *so that* a launch can happen is a 3 or 4. Proposing a control *as a gate before* anything happens is a 2 or 3.
5. **Return null** when the message has no leaning, for example:
   - pure logistics ("Let's move to item 4")
   - neutral questions ("What is Callowen's containment rate at other banks?")
   - factual reports without a recommendation
   - procedural motions
   - off-topic remarks
6. **Do not code tone.** An angry message is not automatically extreme; a polite one is not automatically balanced.
7. **Chair summaries** that restate other members' views without adding their own are null.
8. **When torn between two adjacent scores,** choose the one closer to 3 only if the message itself hedges. Otherwise choose the more extreme score.

## Worked examples

1. **Walter Ingebretsen (CRO):** "I can't support putting Ravelle Decisioning into live credit decisions this year. We have no validation capability, no fair lending testing, and no monitoring. Take it off the agenda until we do."
   `1`. He opposes the initiative and his preconditions amount to not proceeding.

2. **Martin Dubrowski (CISO):** "I'm fine with Brevanta Workspace for internal policy lookup, but only after we finish a data classification review. Nothing customer-facing until next year."
   `2`. Open to AI, but limited to internal use, gated, and pushed later.

3. **Raymond Achterberg (Chair):** "I propose we approve the Callowen pilot for card activation calls only, on 10% of volume for 90 days, and come back with containment and complaint numbers before expanding."
   `3`. He approves with proportionate, phased gates.

4. **Brooke Lindqvist (Marketing):** "Vallory Bank already has a chat assistant live. If we wait for a perfect policy we lose another two quarters of acquisition. Let's sign Orrin Signal this month and build the review process as we go."
   `4`. She argues for speed now, with controls running in parallel and competition as the reason.

5. **Hector Villaseñor (Consumer Lending):** "Put Ravelle on all installment and auto applications by March. The approval lift pays for the whole AI budget. Fairness testing is the vendor's job, and the vendor says they've done it."
   `5`. He wants maximum scope on credit decisions, fast, and brushes off the risk concerns.

6. **Gail Pruszynski (CFO):** "Before we discuss this, can someone tell me whether the $412,000 for Meridian Insight AI is inside the $6 million or on top of it?"
   `null`. A neutral clarifying question with no leaning.

7. **Priya Raghunathan (CIO):** "I want this, but honestly my team has 40 person-weeks free in Q1. If we approve three projects we deliver none. Approve Callowen, defer the other two."
   `3`. She supports AI but narrows scope for capacity reasons; the net recommendation is to approve one and defer two.

8. **Elaine Moorcroft (GC):** "Generated marketing emails going to customers without legal review is a UDAAP problem waiting to happen. I'd vote no on Orrin Creative as proposed."
   `2`. She opposes this customer-facing use as proposed but not AI in general.

## Edge cases

- **Sarcasm.** "Sure, let's just let the model approve everyone" is caution: code by the intended meaning.
- **Conditional aggression.** "If the vendor passes validation, I want it on every channel by summer" is a 4. The condition is proportionate, and the scope and speed are aggressive.
- **Supporting a pause of a live system after an incident** is a 1 or 2, depending on whether the speaker wants it retired (1) or fixed and relaunched (2).
- **Arguing to spend less while doing the same initiatives** is a stance on spend, not AI pursuit. Return null unless it changes scope or speed.
- **Votes with rationale.** Code the rationale text the same way as a message.
- **Messages that address several items with different stances.** Code the overall net stance. If the stances truly cancel out, use 3.

## Human coder disagreements

Record each coder's score independently before discussing. Report agreement as weighted Cohen's kappa (linear weights) on the 1-5 items. Also report null-versus-non-null agreement separately, as unweighted kappa. After adjudication, write the resolved score and a one-line reason in `analysis/validation/stance_adjudication.csv`. Never overwrite the original independent codes.
