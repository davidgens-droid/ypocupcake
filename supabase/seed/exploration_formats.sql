-- Exploration Formats — seed data
-- Source: Hesse Partners "Forum Tools Moderator Guide 2025"
-- Run after migrations. Idempotent (upsert on code).

insert into exploration_formats
  (code, category, display_name, default_minutes, short_description, moderator_instructions)
values
  -- ─── EQ Tools ───────────────────────────────────────────────────────────
  ('fsfe', 'EQ', 'Four-Step Forum Exploration', 60,
   'A powerful framework for a member to frame and explore unresolved topics with high emotional complexity. Presenter shares their question and journey as a "gift" to the Forum mates, who respond with self-curiosity and resonance.',
   'Phases: 1) Presentation. 2) Clarifying Questions. 3) Experience Sharing (random order). 4) Member Reflection. Essential: no judgment or advice — members listen with curiosity, respect, and compassion. Members resonate, do not repair. See FSFE handout for full outline.'
  ),
  ('blind_window', 'EQ', 'Blind Window Feedback', 15,
   'Based on the Johari Window. The member shares more deeply from their Hidden Window and requests Forum mates'' feedback into their Blind Window. Useful for pondering a decision, situation, or challenge. Recommended for experienced forums who know each other well.',
   'Essential: no judgment or advice; members listen curiously with respect and compassion. 1) Member presents summary/key points of the situation (3 min). 2) Member turns their back to the group; forum members each share blind-window feedback (10 min, random order). 3) Invite the member to rejoin and share any insights (2 min).'
  ),
  ('connection', 'EQ', 'Connection / Self-Discovery', 30,
   'Forum members use a structured activity, set of questions, or other self-discovery process to strengthen self-awareness and group connection.',
   '1) Member or moderator finds a useful exercise; pre-work distributed if needed with full instructions. 2) Moderator sets up the exercise with any worksheets/tools required. 3) Members complete worksheets, work in small groups to refine, then share with the whole group as the exercise design dictates. Time variable: 15–45 minutes.'
  ),
  -- ─── IQ Tools ───────────────────────────────────────────────────────────
  ('lightning_round', 'IQ', 'Lightning Round', 5,
   'A simple question, included on the agenda or raised in the meeting. Members have relevant information top of mind, or arrive prepared, and all share succinctly.',
   'Objective: gather fast input from the group. Question may be provided ahead or impromptu (e.g., "How much emergency cash do you keep on hand?"). Each member <1 min to answer. No Q&A or discussion — individual sharing only.'
  ),
  ('brainstorm', 'IQ', 'Brainstorm', 12,
   'A focused question or situation invites spontaneous ideation. No judgment. No questions unless essential. Capture ideas in real time, visible to the group, so they can be given to the originating member.',
   'Objective: generate as many unique and novel ideas as possible. No debate or disagreement. 1) Member or moderator quickly frames the question (e.g., "Effective ways to retain talent"). 2) Appoint a scribe (flip chart or whiteboard). 3) 1 minute of silence — all write down ideas. 4) Each member shares one idea from their notes (1 min). 5) Open floor to a "popcorn" round of contributions. 6) Originator can take notes/photos to use afterward. Time: 10–15 minutes.'
  ),
  ('topical_discussion', 'IQ', 'Topical / Round Table Discussion', 25,
   'Topics may be scheduled in advance (on agenda) or impromptu. General topic or a specific issue; moderated discussion is directed to the topic ("in the center of the table"), not at any one member. When provided in advance, the group can reflect, research, and prepare.',
   'Objective: share experiences/expertise to expand understanding of the topic and gain alternative perspectives and divergent ideas. Moderator introduces topic and sets focus and boundaries (2–3 min). Use a publicly displayed timer; keep discussion crisp. Stay on topic — don''t debate, politic, or preach. Finish with each member sharing their take-home value. Time: 20–30 minutes.'
  ),
  ('needs_and_leads', 'IQ', 'Needs & Leads', 9,
   'NEEDS: members make a specific request to the group (a question, a connection, or another specific request). LEADS: members share leads — positive or negative experiences with vendors, suppliers, clients — for others'' benefit. Members make notes for themselves.',
   'Two passes (random order each): first NEEDS, then LEADS. Members listen and capture for themselves; no extended discussion. Time: 8–10 minutes.'
  ),
  ('learning_exchange', 'IQ', 'Learning Exchange (Podcast / Book / Video)', 40,
   'Content is suggested in advance so the whole group can read, watch, or listen as pre-work for an informed discussion.',
   '1) A member leads, providing framing and focus for the discussion. 2) Each member summarizes what they learned, took away, or a question they are pondering. 3) If useful, a scribe captures key points for the group. Time: 20–60 minutes.'
  ),
  ('internal_expert', 'IQ', 'Internal Expert (Subject Matter Expert)', 30,
   'A member of your forum (or chapter) has relevant, deep expertise to share on a specific topic — recently acquired knowledge or professional expertise.',
   'Objective: unique, diverse, innovative ideas — no debate or opinions. May be planned (future) or impromptu (today); when planned, the meeting may be held at a relevant location (plant or office). Member presents 10–15 minutes (visuals if useful), then a moderated 10–20 minute Q&A, then close with a take-home/learning round.'
  ),
  ('external_expert', 'IQ', 'External Expert', 30,
   'Some parking-lot questions/subjects benefit from the knowledge, experience, and expertise of a credible external expert. Identify and invite an expert to a future meeting with clear expectations of topic, timing, and useful background of the forum and this process.',
   'Identify and contact an available expert for a parking-lot topic where specific expertise is essential (e.g., mental health, financial planning, tax planning, executive comp, child psychologist, employment law, ESOP plans). Introduce the speaker (prepared 15-min talk), moderate a lively Q&A — take detailed/specific questions offline. Close after ~30 minutes with a debrief or experience-share round.'
  )
on conflict (code) do update set
  category               = excluded.category,
  display_name           = excluded.display_name,
  default_minutes        = excluded.default_minutes,
  short_description      = excluded.short_description,
  moderator_instructions = excluded.moderator_instructions;
