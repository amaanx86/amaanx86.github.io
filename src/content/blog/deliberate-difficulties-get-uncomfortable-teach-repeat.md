---
title: "Desirable Difficulties"
description: "Desirable difficulties is a cognitive psychology idea: making learning harder on purpose slows you down now and makes it stick later. This is the loop I run on to keep growing as a platform engineer, and the one I'm running now to get my head around AI/ML."
date: 2026-07-31
tags: ["career", "learning", "devops", "platform-engineering", "growth"]
draft: false
---

Most people learn the fast way now. Copy the snippet the AI gives you, follow the tutorial, ship it. That's fine, up to a point. But if that's the whole loop you stay shallow, and you end up with a career's worth of experience that's really one year repeated ten times.

There's a name for the alternative, and it's from cognitive psychology, not a productivity thread. It's called **desirable difficulties**: intentional friction in how you learn slows your progress now but drastically improves what sticks, and the part that matters at work, your ability to apply it to a problem you've never seen. The easy path feels productive. The hard path is productive. Those aren't the same thing, and your brain is very good at lying to you about which one you're on.

So here's the loop I run on: read, experiment, get uncomfortable, teach, repeat. If it were that simple everyone would already do it, so let me be specific.

One thing up front. Before the open source, before the Go, before any of the code, I'm a DevOps and platform engineer. My problems are shaped like the systems I run: infrastructure that has to stay up, a migration that can't lose data, a legacy service nobody wants to touch. The loop is the same everywhere.

One more thing, because you'll notice it. I wrote a lot of this with an AI in the loop, on a site I build with one. That's not the shortcut I opened by warning about. What keeps you shallow isn't the tool, it's reaching for it without thinking: pasting what it hands you, shipping it, never asking why it works or what breaks when you pull a line. Used the other way it gets you to the hard part faster instead of letting you skip it. I still own every call here, still have to verify the output and rewrite it until it says what I actually mean, and the moment I stop doing that is the moment it makes me worse, not better. The tool didn't change the discipline. It raised the cost of skipping it.

---

## Read what tells you *why*, not just *how*

Tutorials teach you what. Books and real docs teach you why. That difference is the whole game.

A tutorial hands you a working result and a false sense of understanding. You followed the steps, it ran, you feel like you learned something. You didn't, you pattern-matched, and the moment the real problem leaves the happy path you're back to searching. Read the actual docs, not the quick-start. The quick-start is a tutorial in a trench coat, built to get you running, not to teach you the tool. The reference, the design rationale, the section nobody reads about why a default is what it is: that's where the depth is.

The work I'm proudest of was less about writing code than reading how the thing was already built, and why, so what I added felt native instead of bolted on. Same with any platform call worth making. You don't get the reasoning behind a hard default, the kind that only clicks once you've watched it save you, from a quick-start. The people who know their tools deeply are, not by accident, the ones who enjoy the work more.

---

## Break things on purpose

Reading alone doesn't cut it. You know the feeling when you copy code, it works, and you move on? That's the trap. It ran, so you stopped thinking.

The people who grow fast ask the annoying question: why does this work, and what breaks if I pull this one line? Then they pull it and watch it break. On a platform that's a throwaway cluster you wreck on purpose, a failover you trigger in staging before it triggers itself in production, a Terraform module you tear down to see what the state really depends on. That's desirable difficulties at its purest. Watching it fail teaches you what the line was for, and copy-paste can't, because copy-paste skips the part where you'd have had to think.

---

## Live at the edge of what you can do

Experimenting means trying things that feel uncomfortable, and that's the part people quietly avoid.

Building the same thing for two years, or reaching only for the first tool you learned, is a comfort zone, and a comfort zone is where growth goes to die. There's a name for the productive spot, the **zone of proximal development**: the band just past what you can do alone. Not so hard you're lost, but hard enough you have to think and maybe ask for help. Too easy, nothing rewires. Too hard, you bounce off.

So aim there on purpose. Take the ticket nobody wants. Most of what I know about how systems fail came from being pushed out of my depth: the migration with no clean rollback, the outage in a layer I didn't understand until it was on fire, the tool I had to learn under pressure because something depended on it. Right now that edge is AI/ML, getting genuinely fluent instead of nodding along. The discomfort isn't a warning sign. It's your brain laying down new pathways. Read it as a green light.

---

## Reach for the hard problems, because nobody hands them out

The growth-making problems don't get assigned. You go get them.

Early on especially, you have to walk up to your lead and say it out loud: "I want something bigger." Volunteer for the work everyone avoids. The legacy service people are scared of. The modernization that means understanding a system nobody documented. The migration with the data-residency constraint. The backlog item that's sat there because it's genuinely hard. That's the work that teaches.

And own the outcome, not the task. There's a real gap between "I did the ticket" and "I made it work in production and I'll be the one who understands it when it pages at 2am." Responsibility is a skill, and you only get better at it by carrying some.

---

## Open source is the most underrated growth tool there is

Once you're doing harder work you want real feedback on it. Open source is the best way to level up that I know.

There's a myth it's for senior engineers who'll flame you for a misplaced brace. It isn't. Your first contribution can be a docs fix, and the moment it lands you're inside a real production codebase, watching how professionals structure, name, and test things, getting review from those same people. The way in is simple: find a project you actually use, open the issues tab, filter for the newcomer-tagged ones, start there. I've contributed upstream to projects far bigger than anything I'd have built alone, and it held every time. Maintainers with a higher bar than mine pulled my bar up with them.

---

## Surround yourself with people whose standards you envy

There's an old line that you're the average of the five people you spend the most time with. It's a cliche because it's true, and it's true for engineering. If everyone around you is fine with messy infra and half-shipped features, that becomes your normal, and your normal becomes your ceiling.

Find people whose work makes you think "I'm not there yet." Communities, maintainers on projects you contribute to, engineers who hold a line you respect. You don't need a formal mentor with scheduled 1:1s. You need regular exposure to a higher bar, because standards are contagious both ways. Being the sharpest person in every room feels good and teaches you nothing.

---

## Teach it, and watch every gap light up

Once you've read, experimented, and been pushed by better engineers, teach. This sounds backwards while you still feel like you're learning. It's the highest-leverage thing on the list.

Feynman's whole point was that if you can't explain something simply, you don't really understand it. Nothing exposes the gap between "I understand this" and "I can explain this" faster than trying to explain it. Write the post, walk a colleague through the design, record a two-minute screen capture. The instant you teach it, every gap lights up: the hand-wavy bit you skated over, the thing you thought you knew but can't put into words. Closing those gaps is where it consolidates.

This post is that. The loop taught me something, so I'm teaching it back, which is how I find out whether I understood it.

---

## The loop

That's it. **Read** the source that explains why. **Experiment** and break things on purpose. **Get uncomfortable** at the edge of what you can do and reach for the work nobody wants. Surround yourself with **higher standards**. Then **teach** it, and repeat.

None of the steps are clever. What makes it work is that every one is a deliberate difficulty, trading short-term comfort for long-term capability on purpose. That's not friction you streamline away. The friction is the mechanism. The engineers who compound over a decade didn't find the smoothest path. They kept choosing the uncomfortable one until it stopped feeling like a choice.

Make it harder on purpose.
