# No spend limit while Gaia is being built

Until a person sets their own spend limit, Gaia asks Jev without one: a run
never stops on the waiting screen to ask, and the terminal prints each run's
requests, tokens and estimated cost. A limit the person sets still works as
before, with the slip that asks before spending past it. This replaces the
$0.10 default from round 14 of the `gaia-v3` session until Gaia ships.

## Why

The reviewer, on round 2's engine page: "can we please like not have a limit
that might cause an error while we are testing? we arent deployed yet so i am
worried we will waste work based on how this is so far." Understanding a
codebase from source costs a few cents at Jev's price, and a run that stops
to ask, or falls back to the stand-in, wastes a test.

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round 2,
in the thread on "When should the engine make its Jev calls?".
