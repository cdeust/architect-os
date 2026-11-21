Feature: Native session files stay inside the admitted allocation

  Scenario Outline: The <profile> session owns its temp and cannot access another allocation
    When the real "<profile>" engine and its child exercise the session locations
    Then both processes used the assigned temp and the protected paths kept their contents

    Examples:
      | profile  |
      | builder  |
      | checker  |
      | reviewer |
      | module   |
      | worker   |
