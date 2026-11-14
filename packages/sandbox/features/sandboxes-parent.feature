Feature: the folders of the sandboxes: a safe parent, and a path short enough for the Unix socket of srt
  Every per-sandbox folder lives in `<tmpRoot>/aos-sb`, which the profiles deny reading. Under Linux `/tmp` is shared:
  the parent is trusted only if it is a real folder (not a link), owned by the current user, of mode exactly 0700. srt
  listens on a Unix socket in the `tmp` folder of the sandbox, whose path holds 103 characters on macOS up to 26: the
  start is refused when `<folder>/tmp` plus 24 characters would not fit, that is when it is over 79 characters.
  No scenario here runs srt.

  Scenario: a missing parent is created with mode 700 and its real path returned
    Given a throwaway temporary root
    When I ask for the sandboxes parent of the root
    Then the parent returned is the folder "aos-sb" of the root
    And the throwaway temporary root holds a folder "aos-sb" of mode "700"

  Scenario: a good existing parent is accepted twice in a row
    Given a throwaway temporary root whose aos-sb is a folder of mode "700"
    When I ask for the sandboxes parent of the root twice
    Then the parent returned is the folder "aos-sb" of the root
    And the throwaway temporary root holds a folder "aos-sb" of mode "700"

  Scenario: a parent that is a symbolic link to a good folder is refused
    Given a throwaway temporary root whose aos-sb is a symbolic link to a folder of mode 700
    When I ask for the sandboxes parent of the root
    Then the parent is refused with the exact message

  Scenario: a parent of mode 755 is refused
    Given a throwaway temporary root whose aos-sb is a folder of mode "755"
    When I ask for the sandboxes parent of the root
    Then the parent is refused with the exact message

  Scenario: a parent that another user owns is refused
    Given a throwaway temporary root whose aos-sb is a folder of mode "700"
    When I ask for the sandboxes parent of the root, the current user being another one
    Then the parent is refused with the exact message

  Scenario: any other error of the creation is thrown as it is
    Given a throwaway temporary root that is a file
    When I ask for the sandboxes parent of the root
    Then the creation of the parent failed with ENOTDIR

  Scenario: a start whose tmp folder leaves no room for the socket is refused and leaves no folder
    Given an srt runner over a throwaway temporary root such that the tmp folder of a sandbox is 80 characters long
    When I try to start profile "builder" with command "true"
    Then it is refused because the tmp folder is 80 characters long
    And no folder is left in the sandboxes parent of the root

  Scenario: a start whose tmp folder is 79 characters long passes the budget, and the canary leaves no folder
    Given an srt runner over a throwaway temporary root such that the tmp folder of a sandbox is 79 characters long
    When I try to start profile "builder" with command "true"
    Then it is refused with "ISOLATION_UNAVAILABLE: canari sans verdict"
    And no folder is left in the sandboxes parent of the root
