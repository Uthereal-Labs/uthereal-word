import { newDocument } from './core.js';
const breakPage = '<div class="page-break" contenteditable="false"><br></div>';
export function clarityReport() {
    const d = newDocument('The clarity report', `
<div class="doc-header"><span>NORTHSTAR &nbsp; / &nbsp; RESEARCH & STRATEGY</span><span>WORKING PAPER &nbsp; · &nbsp; 2026</span></div>
<p class="eyebrow">PERSPECTIVES &nbsp; / &nbsp; 01</p>
<h1 class="cover-title">A little clarity.<br>A world of possibility.</h1>
<p class="lead">Good ideas deserve room to grow. A perspective on building<br>more thoughtful products, teams, and everyday experiences.</p>
<div class="byline"><span><strong>Prepared by</strong><br>Design & Research</span><span><strong>Published</strong><br>September 2026</span><span><strong>Reading time</strong><br>4 minutes</span></div>
<div class="metric-grid"><div class="metric"><div class="metric-value">24</div><div class="metric-label">Conversations</div><p class="metric-note">Real people, real perspectives</p></div><div class="metric"><div class="metric-value">06</div><div class="metric-label">Emerging themes</div><p class="metric-note">From complexity to clarity</p></div><div class="metric"><div class="metric-value">01</div><div class="metric-label">Shared direction</div><p class="metric-note">A more considered future</p></div></div>
<h2>Executive summary</h2>
<p>The best work does not start with more. It starts with a better question. As our tools become more capable and our days more connected, the opportunity is not simply to move faster. It is to make space for what matters.</p>
<p>This report explores a simple idea: <strong>clarity is a competitive advantage.</strong> When we remove unnecessary friction, connect our decisions to real needs, and give people room to think, better outcomes follow.</p>
<blockquote>“Make the important things clear, and the clear things meaningful.”</blockquote>
<p class="caption">An editable sample document. All research figures in this report are illustrative.</p>
${breakPage}
<div class="doc-header"><span>NORTHSTAR &nbsp; / &nbsp; RESEARCH & STRATEGY</span><span>THE CLARITY REPORT &nbsp; · &nbsp; 02</span></div>
<p class="eyebrow">UNDERSTANDING THE OPPORTUNITY</p>
<h1 class="chapter-title">Less noise.<br>More intention.</h1>
<h2>01 &nbsp; The opportunity</h2>
<p>Every handoff, approval, and interface asks for a little of our attention. Individually, these demands seem small. Together, they shape how much energy we have left for the work that only people can do: noticing, connecting, imagining, and deciding.</p>
<p>Our illustrative research brings together 24 conversations across product, design, and operations. Although the contexts differ, the underlying needs are remarkably consistent. People want to understand the next step, trust the information in front of them, and see how their work contributes to a larger purpose.</p>
<h3>What we heard</h3>
<ul><li><strong>Give me a clear starting point.</strong> A little structure creates confidence without limiting possibility.</li><li><strong>Keep the important things close.</strong> Context should travel with the work, not live in another tab.</li><li><strong>Let me focus.</strong> Fewer interruptions make room for deeper thinking and more considered decisions.</li></ul>
<h2>02 &nbsp; What we learned</h2>
<p>Clarity is not the absence of detail. It is the right detail, at the right moment, presented in a way that helps someone move forward. The strongest experiences combine a clear hierarchy with thoughtful defaults and an easy path to more depth.</p>
<table><thead><tr><th>Theme</th><th>What it means</th><th>Design response</th></tr></thead><tbody><tr><td>Purpose</td><td>Know why the work matters</td><td>Make the goal visible</td></tr><tr><td>Continuity</td><td>Keep context across tasks</td><td>Connect the workflow</td></tr><tr><td>Confidence</td><td>Act without second-guessing</td><td>Offer useful feedback</td></tr><tr><td>Focus</td><td>Spend attention intentionally</td><td>Reduce avoidable noise</td></tr></tbody></table>
<p class="caption">Table 1. Illustrative themes translated into practical design principles.</p>
${breakPage}
<div class="doc-header"><span>NORTHSTAR &nbsp; / &nbsp; RESEARCH & STRATEGY</span><span>THE CLARITY REPORT &nbsp; · &nbsp; 03</span></div>
<p class="eyebrow">FROM INSIGHT TO ACTION</p>
<h1 class="chapter-title">A thoughtful way forward.</h1>
<h2>03 &nbsp; A way forward</h2>
<p>We recommend a small, deliberate beginning. Choose one important journey, understand where people lose confidence, and improve it end to end. A focused intervention teaches us more than a collection of disconnected changes.</p>
<h3>Start with the essentials</h3>
<p>Bring the team together around a shared question. Map the current experience. Identify the moments that matter most, then decide what should become simpler, what should become more visible, and what can be removed altogether.</p>
<h3>Build, listen, refine</h3>
<p>Create a working version early. Put it in front of the people who will actually use it. Watch what they do, listen to what they expect, and use the distance between the two as a guide for the next iteration.</p>
<div class="callout"><strong>A useful principle</strong><br>Start with the smallest change that creates a meaningful improvement. Make it real. Learn from it. Then make the next thoughtful move.</div>
<h2>04 &nbsp; Next steps</h2>
<ol><li><strong>Align on the question.</strong> Agree on the outcome we want to make possible.</li><li><strong>Choose the first journey.</strong> Prioritize a clear need with room for measurable improvement.</li><li><strong>Make an early version.</strong> Turn a promising direction into something people can use.</li><li><strong>Learn in the open.</strong> Share observations, document decisions, and refine together.</li></ol>
<h2>Closing thoughts</h2>
<p>Progress is often quieter than we expect. A clearer sentence. A more useful default. A conversation that connects two perspectives. These small choices create the conditions for bigger possibilities.</p>
<p>Let us make more of them.</p>

`);
    return d;
}
export function projectBrief() { return newDocument('Project brief', `<p class="eyebrow">PROJECT BRIEF / 2026</p><h1 class="cover-title">A clear beginning.</h1><p class="lead">Give your next project a shared direction.</p><h2>Overview</h2><p>Describe the opportunity, the people you are building for, and the change you hope to create.</p><h2>Objectives</h2><ul><li>Define a meaningful outcome.</li><li>Make success measurable.</li><li>Keep the team aligned.</li></ul><h2>Scope & deliverables</h2><table><tr><th>Deliverable</th><th>Owner</th><th>Target date</th></tr><tr><td>Discovery & research</td><td>Design team</td><td>Week 1</td></tr><tr><td>Working prototype</td><td>Product team</td><td>Week 3</td></tr><tr><td>Review & iteration</td><td>Everyone</td><td>Week 4</td></tr></table><h2>Open questions</h2><p>What do we need to learn before moving forward?</p><h2>Next steps</h2><p>Agree on the first action and the person responsible.</p>`); }
export function meetingNotes() { return newDocument('Meeting notes', `<p class="eyebrow">WORKING TOGETHER</p><h1 class="cover-title">Notes worth keeping.</h1><p class="lead">A simple space for the conversation and what comes next.</p><p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}<br><strong>Attendees:</strong> Add your team here</p><h2>Agenda</h2><ol><li>Progress and updates</li><li>Decisions to make</li><li>Next steps</li></ol><h2>Discussion</h2><p>Capture the important ideas, context, and perspectives.</p><h2>Decisions</h2><p>What did we agree on, and why?</p><h2>Action items</h2><table><tr><th>Action</th><th>Owner</th><th>Due date</th></tr><tr><td>First next step</td><td>Your name</td><td>To be agreed</td></tr><tr><td>Follow-up</td><td>Your name</td><td>To be agreed</td></tr></table>`); }
export const templates = { blank: () => newDocument(), report: clarityReport, brief: projectBrief, notes: meetingNotes };
