Feature: The setting of a runtime root (domain: its spelling, before any disk is inspected)
  ARCHITECT_OS_RUNTIME_ROOT is required when it is absent or empty, unsafe when it is not a canonical absolute path
  (relative, `/`, a NUL, an empty, `.` or `..` component, a final slash), and canonical otherwise. Whether a canonical
  path is free of links is the filesystem's question.

  Scenario Outline: the runtime root setting "<setting>" is spelled <spelling>
    Then the runtime root setting "<setting>" is spelled "<spelling>"

    Examples:
      | setting          | spelling  |
      | /mnt/aos         | canonical |
      | /mnt/a b/.aos    | canonical |
      | /mnt/aos/        | unsafe    |
      | /mnt/aos/..      | unsafe    |
      | /                | unsafe    |
      | mnt/aos          | unsafe    |
      |                  | required  |
