# The journal riffles and reads like a book

The journal reaches a far page by a riffle: many leaves run over one after
another, several in the air at once, each a page of real code from the
files on the way, and the last carries the page asked for once it is whole.
The page beside the open one turns on one leaf. The book never turns to a
page in between. A turning leaf bends from the spine and casts a soft
shadow. A riffle's leaves turn flat. The edge of the leaves on each side is as thick as the pages
lying there. A crimson silk ribbon stays at the page a riffle began from,
lying in the gutter's shadow clear of the writing, and a tap on it riffles
back.

A page shows its code plain. A file's first page leads with the definition
Jev judged most important, by importance alone, and a folder's with its
most important file, with no label and no stroke, and list rows carry no
marks. Jev's key and weak marks appear only in the appendix, and there is
no best. Every block of code is a tap to the same code in full in the
appendix, with a reference by hand under it, and the appendix's first page
has a reference back. Each folder in a page's path is a tap to its page. A
package's building or landmark opens a page listing what its folder holds,
with the packages it uses and those that use it at the foot, each a tap to
its page. Over a painting the pointer becomes a pointing hand, and the
painting's colors never change.

## Why

The reviewer, asking for this session from `engine-jev` (thread
`f6c5a8e4`): "Sometimes when I hover over the left side of a page to turn
back, the drawn image of the entity changes lighting or something";
"navigation is SUPER unclear. How do I get to the appendix for the right
code block? What do I click on?"; "I have ended up in weird cycles for some
imports that depend on eachother without being able to get to the files
underneath them"; of the old leafing, "sometimes a single page flips back
and forth over and over and over again. I was hoping it would just look
like the journal is turning many many many many pages until it lands where
it needs to go."; and of the lead, "the whole 'best' 'worst' or whatever
thing we did ... it's actually more distracting than not. I would just show
a code block."

On round 1's pages the reviewer chose the riffle, only the pointer's hand
over a painting, a building's page listing what its folder holds, each
folder in the path a tap, code and a reference to reach the appendix, a
lead of the most important part, and Jev's marks only in the appendix.
For a real book's feel he chose edges that show the place, a ribbon back,
the leaf's shadow and leaves that bend, and left out thumbing the edge. Of the
riffle's placeholder leaves (thread `ffa498fb`): "actual code from the repo
would make this feel amazing". Of the first ribbon (thread `e1cb9da5`):
"focus on making the ribbon more realistic please so it doesnt look like a
stick haha ... it's super distracting so close to the code/text like that".
In round 2 he chose crimson. In the thread on the bending leaf
(`9dcfc9cc`), a riffle's first and last leaves were to bend, the leaves
between to stay flat, provided a measurement showed no stutter. Measured in
the lab, each riffle that bent them held the page's thread for 490 to 660 ms
once, against at most 83 ms flat, so a riffle's leaves turn flat for now.

## Settled

Pair session `journal-polish-demo` (`8f779d65-51f4-4637-9ddf-1af6c08cfa7a`),
round 1, on its pages ("Turning many pages", "The drawing's light on
hover", "Import cycles", "Getting to the appendix", "The code a page
shows", "Moments that make people go wow") and in its threads (`ffa498fb`,
`e1cb9da5`); round 2, on "The ribbon back" (Crimson), "A leaf that bends as
it turns" and "Page edges that show the place", and in its thread
(`9dcfc9cc`); and Build it after round 2. It supersedes the lead and marks
of [decision 59](59-the-journal-shows-scores-as-percentages-and-leads-with-best-and-worst.md)
and [decision 62](62-the-journal-reads-best-and-weak-with-meters.md): a
page no longer leads with its best and weak parts, a long definition no
longer opens on its weak block, and no page but the appendix marks its
code. Their percentages, meters and caption stay.
