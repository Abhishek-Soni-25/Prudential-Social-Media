"""Generate data/demo_samples.json: 50 Prudential-themed samples per demo channel.

Distribution per channel (50): 20 benign, 12 reputational/abusive, 7 compliance,
5 market-abuse, 6 cyber. Every item references Prudential so the relevance filter passes;
the Gemini classifier then decides the actual risk category/severity.
"""

import json
from pathlib import Path

PRODUCTS = ["PruShield", "PRUWealth", "PRUActive Saver", "PRULink", "PRUVantage",
            "critical illness plan", "hospital plan", "ILP", "endowment plan", "term life"]

# (category, count) per channel
PLAN = [("benign", 20), ("reputational", 12), ("compliance", 7),
        ("market_abuse", 5), ("cyber", 6)]

T = {
    "x": {
        "benign": [
            "Just renewed my {p} with Prudential Singapore, smooth process 👍",
            "Prudential Singapore's new {p} looks decent for retirement planning.",
            "Attended the @prudentialsg financial wellness webinar today, useful stuff.",
            "Prudential Singapore reports steady results for its SG unit this quarter.",
            "Shoutout to my Prudential Singapore agent for explaining {p} clearly.",
            "Prudential SG launching a new {p} next month apparently.",
        ],
        "reputational": [
            "Prudential Singapore denied my {p} claim with zero explanation. Absolute scam. #BoycottPrudential",
            "Worst service ever from @prudentialsg. Telling everyone to cancel their {p}.",
            "Prudential Singapore is a fraud, they stole my premiums. Spread the word.",
            "Disgusting how Prudential SG treats loyal customers. Avoid this company.",
            "@prudentialsg your agents are liars. My {p} was mis-sold. Reporting to MAS.",
        ],
        "compliance": [
            "A Prudential Singapore agent told me to hide my medical history on the {p} form to get approved 😳",
            "Heard Prudential SG reps are pushing {p} on elderly clients who don't understand it.",
            "My Prudential agent said he'd backdate my {p} application. Is that even legal?",
        ],
        "market_abuse": [
            "Insider tip: Prudential Singapore results leak early — buy before the announcement, we pump together 🚀",
            "Someone inside Prudential SG says big news next week. Load up now before it moves.",
            "Coordinated buy on Prudential-linked counter at 3pm, everyone in 🚀",
        ],
        "cyber": [
            "Found Prudential Singapore customer data (NRIC + policy numbers) being sold on a Telegram channel.",
            "Prudential SG portal is leaking policyholder details, screenshots going around.",
            "There's an exposed API key for Prudential Singapore's site in their JS bundle.",
        ],
    },
    "telegram": {
        "benign": [
            "Anyone here using Prudential Singapore {p}? Thoughts on returns?",
            "Prudential SG townhall was today, decent updates on the {p} lineup.",
            "Comparing Prudential Singapore {p} vs other insurers, seems competitive.",
            "Prudential Singapore agent recommended {p}, sounds reasonable.",
            "Good webinar by Prudential Singapore on retirement and {p}.",
            "FYI Prudential SG updated their {p} brochure.",
        ],
        "reputational": [
            "Stay away from Prudential Singapore, they rejected my {p} claim for no reason. Scammers.",
            "Prudential SG is the worst, telling all my contacts to avoid them.",
            "Prudential Singapore agents are crooks, my {p} was completely mis-sold.",
            "Boycott Prudential Singapore, they don't pay out claims. Pass it on.",
            "Prudential SG cheated my parents on their {p}. Disgraceful.",
        ],
        "compliance": [
            "A Prudential Singapore agent in this group is telling people to omit pre-existing conditions on {p} forms.",
            "Someone claiming to be Prudential SG staff is sharing internal {p} pricing here.",
            "Prudential agent offering to forge signatures on {p} docs, screenshots below.",
        ],
        "market_abuse": [
            "Got word from a Prudential Singapore insider — results beat next week, accumulate quietly now.",
            "Pump plan: everyone buy the Prudential-linked stock at open tomorrow 🚀",
            "Leaked Prudential SG numbers before earnings, DM for details, trade before it's public.",
        ],
        "cyber": [
            "Selling Prudential Singapore policyholder database, 50k records with NRIC. DM.",
            "Prudential SG admin panel creds are floating around, anyone want access?",
            "Dumped Prudential Singapore customer emails + phone numbers, link in bio.",
        ],
    },
    "whatsapp": {
        "benign": [
            "Reminder: Prudential Singapore {p} submission deadline is Friday team.",
            "Client wants info on Prudential SG {p}, sending brochure.",
            "Prudential Singapore agency lunch at Marina One 12:30, who's in?",
            "Updated Prudential {p} illustration attached for the client meeting.",
            "Prudential SG training on the new {p} is next Tuesday.",
            "Closed a Prudential Singapore {p} case today, good month so far.",
        ],
        "reputational": [
            "Client is furious, says Prudential Singapore is a scam after the {p} claim got denied.",
            "Another angry Prudential SG customer threatening to post about us online over their {p}.",
            "This Prudential Singapore complaint is going viral, the {p} denial looks bad.",
            "Customer calling Prudential SG fraudsters in the group chat over a {p} dispute.",
            "PR issue: Prudential Singapore trending negatively over a {p} rejection.",
        ],
        "compliance": [
            "Don't email this — keep it on WhatsApp. The Prudential Singapore vendor side-deal must not show up in the audit.",
            "Just tell the client the Prudential SG {p} guarantees returns, close the sale, deal with it later.",
            "We can backdate the Prudential {p} forms, the compliance team won't check.",
        ],
        "market_abuse": [
            "Heard from finance the Prudential Singapore results leak early — tell the team to buy before it's announced.",
            "Keep quiet but accumulate the Prudential-linked counter before next week's Prudential SG news.",
            "Non-public Prudential Singapore numbers attached, trade on it before disclosure.",
        ],
        "cyber": [
            "Found an exposed admin endpoint on Prudential Singapore's portal leaking NRIC + contact data, and a hardcoded API key. Sellable.",
            "I have a copy of the Prudential SG customer database, we could sell the {p} leads.",
            "Prudential Singapore's internal VPN creds are on this paste, don't share outside.",
        ],
    },
    "quora": {
        "benign": [
            "What is the difference between Prudential Singapore's {p} and a regular savings plan?",
            "Is Prudential Singapore {p} worth it for a 30 year old? Looking for neutral views.",
            "How does Prudential Singapore {p} compare with other insurers in Singapore?",
            "Can someone explain how Prudential SG {p} payouts work?",
            "Is Prudential Singapore a reputable insurer for {p}?",
            "What riders should I add to my Prudential Singapore {p}?",
        ],
        "reputational": [
            "Is Prudential Singapore a scam? My agent dodged questions about my {p} surrender value and I feel cheated.",
            "Why does Prudential Singapore keep denying {p} claims? Feels like fraud.",
            "Has anyone else been ripped off by Prudential SG on their {p}?",
            "Prudential Singapore mis-sold me a {p}. How do I report them to MAS?",
            "Why is everyone saying boycott Prudential Singapore over {p} claims?",
        ],
        "compliance": [
            "My Prudential Singapore agent told me to lie about my health on the {p} form. Is that allowed?",
            "A Prudential SG agent offered to backdate my {p}. Should I report this?",
            "Is it legal for a Prudential Singapore agent to guarantee {p} returns verbally?",
        ],
        "market_abuse": [
            "Someone claims to have insider info on Prudential Singapore earnings — is trading on that legal?",
            "A group is coordinating to pump a Prudential-linked stock before the Prudential SG results. Is this manipulation?",
            "Is it insider trading if I buy based on leaked Prudential Singapore numbers?",
        ],
        "cyber": [
            "I think Prudential Singapore's website leaked my NRIC and policy details — what do I do?",
            "Someone is selling a Prudential Singapore customer database online. Is my data safe?",
            "Found my Prudential SG account exposed due to a portal bug — how to report a data leak?",
        ],
    },
}

URL = {
    "x": "https://x.com/i/web/status/{n}",
    "telegram": "https://t.me/SGInvestTalk/{n}",
    "whatsapp": "wa://msg/{n}",
    "quora": "https://quora.com/q/{n}",
}
AUTHORS = {
    "x": ["sg_saver", "policy_holder_sg", "fin_sg", "kaypoh_sg", "insurewatch", "angry_client"],
    "telegram": ["sgfi_member", "invest_kaki", "fin_guru_sg", "anon_trader", "pru_watch"],
    "whatsapp": ["+6590000{n:03d}", "agent_lead", "branch_mgr", "team_sg", "ops_desk"],
    "quora": ["quora_user_{n}", "sg_asker", "neutral_reviewer", "confused_policyholder"],
}


def build(channel: str) -> list[dict]:
    out, n = [], 0
    cats = T[channel]
    for cat, count in PLAN:
        templates = cats[cat]
        for i in range(count):
            tpl = templates[i % len(templates)]
            product = PRODUCTS[(n) % len(PRODUCTS)]
            text = tpl.replace("{p}", product)
            authors = AUTHORS[channel]
            author = authors[n % len(authors)].format(n=n + 1)
            out.append({
                "id": f"{channel}-{n+1}",
                "author_id": author,
                "text": text,
                "url": URL[channel].format(n=n + 1000),
            })
            n += 1
    return out


def main() -> None:
    samples = {ch: build(ch) for ch in T}
    path = Path(__file__).resolve().parent.parent / "data" / "demo_samples.json"
    path.write_text(json.dumps(samples, indent=2), encoding="utf-8")
    print(f"wrote {path}")
    for ch, items in samples.items():
        print(f"  {ch}: {len(items)} samples")


if __name__ == "__main__":
    main()
