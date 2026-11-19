Feature: The settings of npm the shell entry aos controls (domain: npm's reading of a variable name)
  npm reads a setting from any variable whose name starts with `npm_config_`, in any case; the rest of the name, but a
  leading `_`, has its `_` turned into `-` and is put in lower case, except the setting of a registry, `//...`
  (npm 11.20.0, @npmcli/config/lib/index.js, loadEnv). `aos` removes every inherited spelling of cache, logs-dir,
  userconfig, globalconfig and node-options, which npm turns into the NODE_OPTIONS of its lifecycle children.

  Scenario Outline: the variable <name> is read by npm as the setting <setting>
    When npm's reading of the variable name "<name>" is taken
    Then the variable name is read as the npm setting "<setting>"

    Examples:
      | name                            | setting                  |
      | npm_config_cache                | cache                    |
      | NPM_CONFIG_CACHE                | cache                    |
      | Npm_Config_Cache                | cache                    |
      | npm_config_logs_dir             | logs-dir                 |
      | npm_config_logs-dir             | logs-dir                 |
      | NPM_CONFIG_LOGS-DIR             | logs-dir                 |
      | npm_config_Node_Options         | node-options             |
      | npm_config__cache               | _cache                   |
      | npm_config__auth_x              | _auth-x                  |
      | npm_config_//registry/:_authToken | //registry/:_authToken |
      | npm_config_cache_extra          | cache-extra              |

  Scenario Outline: the variable <name> is not a setting of npm
    When npm's reading of the variable name "<name>" is taken
    Then the variable name is not read as a setting of npm

    Examples:
      | name             |
      | npmconfig_cache  |
      | npm_config       |
      | x_npm_config_cache |
      | NPM_CONFIGCACHE  |

  Scenario: of the names of an environment, those npm reads as a controlled setting are kept, in their order
    When the controlled npm names are taken from "PATH,NPM_CONFIG_USERCONFIG,npm_config_registry,npm_config_globalconfig,npm_config__cache,npm_config_cache_extra,npm_config_logs-dir,npm_config_Cache,NPM_CONFIG_NODE-OPTIONS,npm_config_node_options_x"
    Then the controlled npm names are "NPM_CONFIG_USERCONFIG,npm_config_globalconfig,npm_config_logs-dir,npm_config_Cache,NPM_CONFIG_NODE-OPTIONS"

  Scenario: the controlled settings are exactly the four locations of a run and node-options
    Then the controlled npm settings are "cache,logs-dir,userconfig,globalconfig,node-options"
