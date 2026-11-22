Feature: the image of the profiles is produced from the profile files, the hand-drawn picture has a tripwire
  A diagram of the isolation is read as a statement of security: one that says less than a profile opens is a false
  statement. Two files, and each says exactly what it guarantees: the generated image lists, for each profile, the
  paths it opens and closes for writing, its network list and its token variables, then counts the paths denied for
  reading, and the gate holds it equal to the files; the hand-drawn picture shows who starts what and what holds the
  credential, and the reviewer of each change reads it.

  docs/diagrams/isolation-profiles.svg is produced whole: one function (features/support/isolation-rows.ts) writes, from
  the five files of packages/sandbox/profiles, a complete image: its title and description, for each profile its role,
  the paths it opens for writing (allowWrite), the paths it closes for writing (denyWrite), the hosts its network list
  allows, the variables of its environment whose value holds the token of a session or of a task, and the count of the
  paths denied for reading, once when the five lists are the same, else one per profile. The guarantee is the equality:
  the first scenarios require the whole file to equal what the function produces from the files of the tree, and a
  difference is refused with the command that regenerates (after a build, since the command imports the built package of
  packages/sandbox); nothing in the file is written by hand. The rules below show what the function does with the text
  it writes: it escapes it, it wraps a long list by one rule, it names a token variable and not its value, and it
  refuses to produce a file in which a text does not fit the room of its line. Two numbers are kept apart: the room of a
  line of a list (112 characters) and the longest item (110, the room of a line less the two characters of the separator
  " ·" that may follow an item).

  All its texts are declared in one list of monospace families, and the width of a text is taken as its count of
  characters times a factor of the size it is drawn at; each text carries its own size. The refusal is shown for each
  kind of text the function draws: the title (17 px), the subtitle (12.5 px), the header and the role (12 px), a line of
  a list and the sentence of the denied reads (11 px), and the name of a profile (12 px) and the label of a list (11 px)
  against the column that holds them. The title, the subtitle, the header and the role are shown through the image
  itself: a constant of that kind, too long for its room, refuses the production of the image. That each text of the
  produced image carries the family the measure assumes and a size, and that each kind is drawn at the size it is
  measured with, is shown on the produced image.

  Read by the reviewer of each change, and shown by no scenario: that the function starts no process; that the factor
  (0.62) is stated in the support file with the render that established it; and what that render covers: Menlo, named
  alone, the generic monospace and the whole list, all drawn in Menlo. The factor is above its measure; the comment of
  the support file says that ui-monospace, the first family of the list, and SF Mono, Consolas and DejaVu Sans Mono
  were not measured, and that a family wider than the factor draws past the room.

  `npm run diagram:isolation` calls one function of the support file; a scenario runs that function on a temporary
  copy of the profiles and of the folder of diagrams, lists the whole copy, directories as well as files, with what
  identifies a write (size, inode, times of modification and of change, content), and shows that the first run writes
  one file, no new directory and no other entry changed, and that the second run changes nothing: a new empty directory
  would be seen, and so would a file rewritten with the same bytes, by its times.

  docs/diagrams/architecture.svg is drawn by hand: it is the one image of the architecture, and its part on the
  sandboxes shows who starts what, and what holds the credential. Its box of Claude Code names two profiles and gives
  them a session token and their own folders, and an arrow says what they reach; the lists of each profile are in the
  other image, which the first scenarios hold equal to the files. No
  scenario backs the statements of the hand-drawn picture: they are read by the reviewer of each change, like the README
  (CLAUDE.md, « What the review must refuse », refuses a change that leaves a diagram as it was). The tripwire of the
  last rule refuses exactly two forms: a template string (a dollar and a brace) and a host of a network list of a
  profile, compared without regard to case. It is not a guarantee: a path or a host written in another form, or prose
  that contradicts the profiles without naming one, passes it.

  It is under features/arch, which the mutation profile leaves out; why is written in cucumber.mjs.

  Rule: the generated image is exactly what the profiles give

    Scenario: the committed image is what the five committed profile files give
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/isolation-profiles.svg"
      Then the generated image is what the five profiles give

    Scenario: the image produced twice from the same files is the same bytes
      Given the five committed profile files of packages/sandbox
      Then the image produced a second time from the same files is the same bytes

    Scenario: a profile that gains a write path, the generated file unchanged, is refused
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/isolation-profiles.svg"
      When the profile "reviewer" gains "${repo}/.git/objects" in its "writes" list
      Then the generated image is refused for exactly
        | the file is not what the profiles give, first difference at line 26; regenerate with: npm run diagram:isolation |

    Scenario: the generated file edited by hand is refused
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/isolation-profiles.svg"
      When the text "${worktree} · ${config} · ${tmp}</tspan>" is replaced by "${worktree} · ${config} · ${tmp} · ${home}/.npm</tspan>"
      Then the generated image is refused for exactly
        | the file is not what the profiles give, first difference at line 14; regenerate with: npm run diagram:isolation |

  Rule: what the function writes

    Scenario: what a profile gains is written escaped
      Given the five committed profile files of packages/sandbox
      When the profile "checker" gains "${tmp}/a&b<c>\"d'" in its "writes" list
      Then the image written for the profiles says "${tmp}/a&amp;b&lt;c&gt;&quot;d&apos;"
      And the image written for the profiles does not say "a&b"

    Scenario: a variable of the environment that holds a token is written by its name, not by its value
      Given the five committed profile files of packages/sandbox
      When the profile "checker" gains "OPENAI_API_KEY" in its "token" list
      Then the image written for the profiles says ">OPENAI_API_KEY</tspan>"
      And the image written for the profiles does not say "${sessionToken}"

    Scenario: a long list wraps on several lines, none longer than the room of a line
      Given the five committed profile files of packages/sandbox
      When the profile "reviewer" gains 12 write paths
      Then no line of a list of the image written is longer than the room of a line
      And the image written for the profiles says "${tmp}/path-number-11</tspan>"

    Scenario: an item one character longer than the longest item is refused, because with the separator that may follow it the line would pass its room
      Given the five committed profile files of packages/sandbox
      When the profile "reviewer" gains a write path one character over the longest item
      Then the image is refused because an item is longer than the longest item, the one character over

    Scenario: an item as long as the longest item is drawn, on a line of its own
      Given the five committed profile files of packages/sandbox
      When the profile "reviewer" gains a write path as long as the longest item
      Then no line of a list of the image written is longer than the room of a line
      And the item is drawn on a line of its own

    Scenario: the sentence of the denied reads is refused when it does not fit its line
      Given the five committed profile files of packages/sandbox
      When each of the five profiles gains 1000 paths denied for reading
      Then the image is refused because the sentence of the denied reads does not fit its line

  Rule: the room of a text is computed for the size it is drawn at

    # The kind "line" is a line of a list: its room, 112, holds an item of at most 110 and the separator " ·" that may
    # follow it.
    # The longest item, 110, is the one of the scenarios above.

    Scenario Outline: a text is drawn whole up to its room and refused one character past it
      Then a text of kind <kind> of <room> characters is drawn whole
      And a text of kind <kind> of <over> characters is refused saying "a text of kind <kind> does not fit its line (<over> characters, <room> at most at <size> px)"

      Examples:
        | kind     | size | room | over |
        | title    | 17   | 88   | 89   |
        | subtitle | 12.5 | 120  | 121  |
        | header   | 12   | 111  | 112  |
        | role     | 12   | 111  | 112  |
        | line     | 11   | 112  | 113  |
        | denied   | 11   | 121  | 122  |
        | name     | 12   | 13   | 14   |
        | label    | 11   | 8    | 9    |

    Scenario Outline: the image passes each of its constants through the measure of its own kind
      Given the five committed profile files of packages/sandbox
      Then the image with a <kind> of <room> characters is produced and holds it whole
      And the image with a <kind> of <over> characters is refused saying "a text of kind <kind> does not fit its line (<over> characters, <room> at most at <size> px)"

      Examples:
        | kind     | size | room | over |
        | title    | 17   | 88   | 89   |
        | subtitle | 12.5 | 120  | 121  |
        | header   | 12   | 111  | 112  |
        | role     | 12   | 111  | 112  |

  Rule: the produced image gives every text a family and a size

    Scenario: every text element of the image carries a size, in the family the measure assumes
      Given the five committed profile files of packages/sandbox
      Then every text element of the image written carries a size and the family the measure assumes

    Scenario: a family or a size set on a tspan of the produced image is refused
      Given the five committed profile files of packages/sandbox
      Then the produced image with a font-family on one of its tspan is refused
      And the produced image with a font-size on one of its tspan is refused

    Scenario Outline: a kind of text is drawn at the size it is measured with
      Given the five committed profile files of packages/sandbox
      Then every text of kind <kind> of the image written is drawn at the size its measure says

      Examples:
        | kind     |
        | title    |
        | subtitle |
        | header   |
        | role     |
        | line     |
        | denied   |
        | name     |
        | label    |

  Rule: the script writes that one file and a second run changes nothing

    Scenario: the function the script calls writes the one file, then changes nothing
      Given the five committed profile files of packages/sandbox
      And a temporary copy of the repository holding the five profiles and a folder of diagrams
      Then the copy listed before the runs holds exactly
        | docs/                                    |
        | docs/diagrams/                          |
        | docs/diagrams/architecture.svg          |
        | packages/                               |
        | packages/sandbox/                       |
        | packages/sandbox/profiles/              |
        | packages/sandbox/profiles/builder.json  |
        | packages/sandbox/profiles/checker.json  |
        | packages/sandbox/profiles/module.json   |
        | packages/sandbox/profiles/reviewer.json |
        | packages/sandbox/profiles/worker.json   |
      When the function of the script is run on the copy
      And the function of the script is run on the copy
      Then the runs wrote "true, false"
      And the first run wrote exactly one file, "docs/diagrams/isolation-profiles.svg"
      And the second run changed nothing in the copy

  Rule: the README embeds the architecture and links to the generated profile details

    Scenario: the README has one architecture diagram and a separate profile link
      Given the text of the committed file "README.md"
      Then the README embeds just the architecture and links to the profile diagram

  Scenario: The README loop groups each capability with its phase and follows the numbered path
    Then each orchestration phase owns its cards and connects to the next phase

  Rule: the tripwire on the hand-drawn picture stops the plain forms only

    Scenario: the committed hand-drawn picture passes its tripwire
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/architecture.svg"
      Then the hand-drawn picture passes its tripwire

    Scenario: the hand-drawn picture with a template string is stopped
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/architecture.svg"
      When the text "the credential stays on the host" is replaced by "the credential stays on the host, not in ${home}/.npm"
      Then the hand-drawn picture is stopped by its tripwire for exactly
        | a template string: ${home}/.npm |

    Scenario: the hand-drawn picture with a host of a profile in upper case is stopped
      Given the five committed profile files of packages/sandbox
      And the text of the committed file "docs/diagrams/architecture.svg"
      When the text "The authentication proxy on the host" is replaced by "The authentication proxy on REGISTRY.NPMJS.ORG"
      Then the hand-drawn picture is stopped by its tripwire for exactly
        | a host of a network list: registry.npmjs.org |
