Feature: the native gateway reads its configuration from its environment, with no default (docs/design/platform-v3-srt.md, §8, 1b.6a)
  readNativeConfig returns what the process entry needs and launches nothing. Every variable is required but
  NODE_EXTRA_CA_CERTS; the store that keeps nothing is a choice the operator writes (DATABASE_URL=memory), not a
  fallback. A child is given its own variables and nothing else. A refusal is a plain Error that names the variable and
  what is expected of it, and never holds its value. In a table, [blank] stands for a blank.

  Scenario: a complete environment gives the whole configuration
    Given a complete environment of the native gateway
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is the complete one for the root "/opt/platform" and the node "/opt/node/bin/node"

  Scenario: the store that keeps nothing is chosen by name, and data is then given nothing
    Given a complete environment of the native gateway
    And the variable "DATABASE_URL" is "memory"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the environment of the process "data" is '{}'
    And the environment of the process "broker" is '{"BROKER_CONFIG":"${BROKER_CONFIG}","NODE_EXTRA_CA_CERTS":"/etc/ssl/inspection.pem"}'

  Scenario: a postgresql:// URL is given to data as it is, and to nothing else
    Given a complete environment of the native gateway
    And the variable "DATABASE_URL" is "postgresql://app@db/platform"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the environment of the process "data" is '{"DATABASE_URL":"postgresql://app@db/platform"}'
    And the environment of the process "broker" is '{"BROKER_CONFIG":"${BROKER_CONFIG}","NODE_EXTRA_CA_CERTS":"/etc/ssl/inspection.pem"}'

  Scenario: the broker gets only its configuration when the gateway has no NODE_EXTRA_CA_CERTS
    Given a complete environment of the native gateway
    And the variable "NODE_EXTRA_CA_CERTS" is absent
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the environment of the process "broker" is '{"BROKER_CONFIG":"${BROKER_CONFIG}"}'
    And the environment of the process "data" is '{"DATABASE_URL":"postgres://app@db/platform"}'

  Scenario: the committed broker configuration gives the port 8084
    Given a complete environment of the native gateway
    And the variable "BROKER_CONFIG" names the committed broker configuration
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration field "brokerPort" is 8084

  Scenario Outline: tokens at the bound are accepted: <case>
    Given a complete environment of the native gateway
    And the variable "GATEWAY_TOKENS" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the tokens of the native configuration are '<tokens>'

    Examples:
      | case | value | tokens |
      | a token of 32 characters, a subject of one | 0123456789abcdef0123456789abcdef=x | {"0123456789abcdef0123456789abcdef":"x"} |
      | a token of 33 characters, a subject of two | 0123456789abcdef0123456789abcdef0=xy | {"0123456789abcdef0123456789abcdef0":"xy"} |
      | a base64 token ended by its padding, a subject with a dot, a dash and an at sign | Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYg===a.b-c@d | {"Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYg==":"a.b-c@d"} |
      | every character a bearer token may hold | ABCXYZabcxyz0189-._~+/ABCXYZabcxyz=x | {"ABCXYZabcxyz0189-._~+/ABCXYZabcxyz":"x"} |
      | two clients | 0123456789abcdef0123456789abcdef=alice;fedcba9876543210fedcba9876543210=bob | {"0123456789abcdef0123456789abcdef":"alice","fedcba9876543210fedcba9876543210":"bob"} |

  Scenario Outline: a value at the bound is accepted: <variable> <value>
    Given a complete environment of the native gateway
    And the variable "<variable>" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration field "<field>" is <number>

    Examples:
      | variable | value | field | number |
      | GATEWAY_PORT | 1 | port | 1 |
      | GATEWAY_PORT | 65535 | port | 65535 |
      | GATEWAY_PORT | 100 | port | 100 |
      | GATEWAY_QUOTA_PER_MINUTE | 1 | quotaPerMinute | 1 |
      | GATEWAY_QUOTA_PER_MINUTE | 100 | quotaPerMinute | 100 |

  Scenario Outline: the port of the broker file at the bound is accepted: <content>
    Given a complete environment of the native gateway
    And the variable "BROKER_CONFIG" names a file holding '<content>'
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration field "brokerPort" is <number>

    Examples:
      | content | number |
      | {"port":1024,"other":true} | 1024 |
      | {"port":65535} | 65535 |

  Scenario Outline: a variable with a defect is refused, naming it: <variable> <defect>
    Given a complete environment of the native gateway
    And the variable "<variable>" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "<message>"

    Examples:
      | variable | defect | value | message |
      | GATEWAY_TOKENS | empty |  | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a token of 31 characters | 0123456789abcdef0123456789abcde=alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a pair without token | =alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | no subject | 0123456789abcdef0123456789abcdef= | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | no equal sign | 0123456789abcdef0123456789abcdef | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | an empty pair | 0123456789abcdef0123456789abcdef=alice;;fedcba9876543210fedcba9876543210=bob | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a pair ended by a separator | 0123456789abcdef0123456789abcdef=alice; | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a token twice | 0123456789abcdef0123456789abcdef=alice;fedcba9876543210fedcba9876543210=bob;0123456789abcdef0123456789abcdef=carol | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a blank before the token | [blank]0123456789abcdef0123456789abcdef=alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a blank in the token | 0123456789abcdef[blank]0123456789abcdef=alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a blank after the subject | 0123456789abcdef0123456789abcdef=alice[blank]  | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a blank in the subject | 0123456789abcdef0123456789abcdef=al[blank]ice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | an equal sign inside the token | 0123456789abcdef=0123456789abcdef=alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a character no bearer token holds | 0123456789abcdef!0123456789abcdef=alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | a token of 31 characters and its padding | 0123456789abcdef0123456789abcd==alice | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_TOKENS | an equal sign in the subject | 0123456789abcdef0123456789abcdef=a=b | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_PORT | empty |  | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | zero | 0 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | beyond the range | 65536 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a fraction | 80.5 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a prefix | x80 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a suffix | 80x | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a sign | -80 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a plus sign | +80 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | an exponent | 8e1 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_PORT | a leading zero | 080 | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_QUOTA_PER_MINUTE | empty |  | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_QUOTA_PER_MINUTE | zero | 0 | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_QUOTA_PER_MINUTE | not a number | many | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_QUOTA_PER_MINUTE | digits after a text | per60 | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_QUOTA_PER_MINUTE | beyond the integers a number holds | 90071992547409930 | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_QUOTA_PER_MINUTE | digits before a text | 60rpm | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_PROFILE | empty |  | GATEWAY_PROFILE must be the name of a client profile |
      | BROKER_CONFIG | empty |  | BROKER_CONFIG must be the absolute path of a JSON file with a port, an integer from 1024 to 65535 |
      | BROKER_CONFIG | a relative path to a valid file | modules/broker/broker.json | BROKER_CONFIG must be the absolute path of a JSON file with a port, an integer from 1024 to 65535 |
      | BROKER_CONFIG | a file that is absent | /no/such/broker.json | BROKER_CONFIG must be the absolute path of a JSON file with a port, an integer from 1024 to 65535 |
      | DATABASE_URL | empty |  | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |
      | DATABASE_URL | another scheme | mysql://app@db/platform | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |
      | DATABASE_URL | a scheme that only ends like it | notpostgres://app@db/platform | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |
      | DATABASE_URL | no slashes | postgres:app@db | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |
      | DATABASE_URL | the name of the store in another case | Memory | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |
      | NODE_EXTRA_CA_CERTS | empty |  | NODE_EXTRA_CA_CERTS must be the absolute path of a certificate file, or absent |
      | NODE_EXTRA_CA_CERTS | a relative path | certs/inspection.pem | NODE_EXTRA_CA_CERTS must be the absolute path of a certificate file, or absent |

  Scenario Outline: a variable that is absent is refused, naming it: <variable>
    Given a complete environment of the native gateway
    And the variable "<variable>" is absent
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "<message>"

    Examples:
      | variable | message |
      | GATEWAY_TOKENS | GATEWAY_TOKENS must be token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ with = only at its end, a subject without blank or =, no token twice |
      | GATEWAY_PORT | GATEWAY_PORT must be an integer from 1 to 65535 |
      | GATEWAY_QUOTA_PER_MINUTE | GATEWAY_QUOTA_PER_MINUTE must be an integer of at least 1 |
      | GATEWAY_PROFILE | GATEWAY_PROFILE must be the name of a client profile |
      | BROKER_CONFIG | BROKER_CONFIG must be the absolute path of a JSON file with a port, an integer from 1024 to 65535 |
      | DATABASE_URL | DATABASE_URL must be a postgres:// or postgresql:// URL, or memory for a store that keeps nothing |

  Scenario Outline: the file of the broker with a defect is refused, naming BROKER_CONFIG: <defect>
    Given a complete environment of the native gateway
    And the variable "BROKER_CONFIG" names a file holding '<content>'
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "BROKER_CONFIG must be the absolute path of a JSON file with a port, an integer from 1024 to 65535"

    Examples:
      | defect | content |
      | not JSON | port = 8084 |
      | null | null |
      | no port | {"upstream":"x"} |
      | a port in a string | {"port":"8084"} |
      | a port the broker refuses | {"port":1023} |
      | a port beyond range | {"port":65536} |
      | a fractional port | {"port":8084.5} |

  Scenario Outline: a sandbox means that is not srt or docker is refused: <case>
    Given a complete environment of the native gateway
    And the variable "GATEWAY_SANDBOX" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "GATEWAY_SANDBOX must be srt or docker"

    Examples:
      | case | value |
      | empty |  |
      | another case | Docker |
      | a blank after it | srt[blank] |
      | another means | podman |

  Scenario: a sandbox means that is absent is refused
    Given a complete environment of the native gateway
    And the variable "GATEWAY_SANDBOX" is absent
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "GATEWAY_SANDBOX must be srt or docker"

  Scenario: srt is the means srt, and nothing else
    Given a complete environment of the native gateway
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the sandbox of the native configuration is '{"means":"srt"}'

  Scenario Outline: srt with a Docker variable is refused, naming it: <variable>
    Given a complete environment of the native gateway
    And the variable "<variable>" is "x"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "<variable> must be absent when GATEWAY_SANDBOX is srt"

    Examples:
      | variable |
      | GATEWAY_DOCKER_IMAGE |
      | GATEWAY_DOCKER_NODE |
      | GATEWAY_DOCKER_MEMORY_MIB |
      | GATEWAY_DOCKER_PIDS |
      | GATEWAY_DOCKER_CHECK_MS |

  Scenario: srt with a Docker variable that is empty is refused all the same
    Given a complete environment of the native gateway
    And the variable "GATEWAY_DOCKER_PIDS" is ""
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "GATEWAY_DOCKER_PIDS must be absent when GATEWAY_SANDBOX is srt"

  Scenario: docker with five good values holds exactly them, the numbers as numbers
    Given a complete environment of the native gateway
    And the environment of the native gateway chooses Docker with good values
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the sandbox of the native configuration is '{"means":"docker","image":"node@sha256:0000000000000000000000000000000000000000000000000000000000000000","node":"/usr/local/bin/node","memoryMiB":512,"pidsLimit":64,"checkTimeoutMs":20000}'

  Scenario Outline: docker without one of its variables is refused, naming it: <variable>
    Given a complete environment of the native gateway
    And the environment of the native gateway chooses Docker with good values
    And the variable "<variable>" is absent
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "<message>"

    Examples:
      | variable | message |
      | GATEWAY_DOCKER_IMAGE | GATEWAY_DOCKER_IMAGE must be the image of the sandboxes, name@sha256:<digest> |
      | GATEWAY_DOCKER_NODE | GATEWAY_DOCKER_NODE must be the absolute path of node in the image |
      | GATEWAY_DOCKER_MEMORY_MIB | GATEWAY_DOCKER_MEMORY_MIB must be an integer of at least 1 |
      | GATEWAY_DOCKER_PIDS | GATEWAY_DOCKER_PIDS must be an integer of at least 1 |
      | GATEWAY_DOCKER_CHECK_MS | GATEWAY_DOCKER_CHECK_MS must be an integer of at least 1 |

  Scenario Outline: docker with a number that is not a positive integer is refused, naming it: <variable> <value>
    Given a complete environment of the native gateway
    And the environment of the native gateway chooses Docker with good values
    And the variable "<variable>" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused with "<variable> must be an integer of at least 1"

    Examples:
      | variable | value |
      | GATEWAY_DOCKER_MEMORY_MIB | 0 |
      | GATEWAY_DOCKER_MEMORY_MIB | -1 |
      | GATEWAY_DOCKER_MEMORY_MIB | 1.5 |
      | GATEWAY_DOCKER_MEMORY_MIB | 08 |
      | GATEWAY_DOCKER_MEMORY_MIB | 1e3 |
      | GATEWAY_DOCKER_MEMORY_MIB | 90071992547409930 |
      | GATEWAY_DOCKER_PIDS | 0 |
      | GATEWAY_DOCKER_PIDS | -1 |
      | GATEWAY_DOCKER_PIDS | 1.5 |
      | GATEWAY_DOCKER_PIDS | 08 |
      | GATEWAY_DOCKER_PIDS | 1e3 |
      | GATEWAY_DOCKER_PIDS | 90071992547409930 |
      | GATEWAY_DOCKER_CHECK_MS | 0 |
      | GATEWAY_DOCKER_CHECK_MS | -1 |
      | GATEWAY_DOCKER_CHECK_MS | 1.5 |
      | GATEWAY_DOCKER_CHECK_MS | 08 |
      | GATEWAY_DOCKER_CHECK_MS | 1e3 |
      | GATEWAY_DOCKER_CHECK_MS | 90071992547409930 |

  Scenario Outline: a refusal does not contain the value that caused it: <variable>
    Given a complete environment of the native gateway
    And the variable "<variable>" is "<value>"
    When the native configuration is read for the root "/opt/platform" and the node "/opt/node/bin/node"
    Then the native configuration is refused without the text "<secret>"

    Examples:
      | variable | value | secret |
      | GATEWAY_TOKENS | tok-s3cret=alice | s3cret |
      | GATEWAY_TOKENS | 0123456789abcdef0123456789abcdef=s3cret;0123456789abcdef0123456789abcdef=bob | s3cret |
      | GATEWAY_PORT | s3cret | s3cret |
      | DATABASE_URL | mysql://app:s3cret@db/platform | s3cret |
      | BROKER_CONFIG | relative/s3cret.json | s3cret |
      | NODE_EXTRA_CA_CERTS | relative/s3cret.pem | s3cret |
      | GATEWAY_SANDBOX | s3cret | s3cret |
