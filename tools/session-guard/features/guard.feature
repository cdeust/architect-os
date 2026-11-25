Feature: the session guard refuses a merge, the approval label, an administrator bypass and a push to a protected branch
  Requirements P7 and P8 of the retired Spec prompts (docs/design/exigences-spec.md, §5). Claude Code runs this guard
  before every Bash and MCP call of a session of this repository (`.claude/settings.json`), and blocks the call when it
  exits with 2. The rule is coarse and closed by default: the whole call is normalized as the shell reads a word
  (quotes and backslashes removed, case ignored, blanks folded); a vehicle to GitHub anywhere and a forbidden object
  anywhere refuse it, unless the whole call is one of a few reads. It is a barrier against mistakes and naive
  injection, not a security boundary: the sessions act under the owner's account. The command is delimited by
  guillemets; `⏎` and `⇥` in a cell are a line break and a tab.

  Scenario Outline: the approval label is set by the owner alone: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit --add-label=owner-approved 3 | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label "bug, owner-approved" | le label d’approbation est posé par le propriétaire seul |
      | L=owner-approved; gh pr edit 3 --add-label $L | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label $L | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label $(echo owner-approved) | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label owner-approv\\ed | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label ow\\ner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label OWNER-APPROVED | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label Owner-Approved | le label d’approbation est posé par le propriétaire seul |
      | \\gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | g\\h pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | 'gh' pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | timeout 30 gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | nice -n 5 gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | stdbuf -o0 gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | find . -maxdepth 0 -exec gh pr edit 3 --add-label owner-approved ; | le label d’approbation est posé par le propriétaire seul |
      | watch -n1 gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | $(which gh) pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | ./gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh.exe pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr --repo o/r edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit --repo o/r 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh issue edit 3 -R o/r --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh -R o/r pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh --repo o/r pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr create --title t --body b --label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr create -l owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh issue create --title t --label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh issue edit 3 --add-label 'a' --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label hold --remove-label hold --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | echo owner-approved \| xargs gh pr edit 3 --add-label | le label d’approbation est posé par le propriétaire seul |
      | gh api repos/o/r/issues/3/labels -flabels[]=owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh api repos/o/r/issues/3/labels --field=labels[]=owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh api repos/{owner}/{repo}/issues/3/labels -f labels[]=owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh api -X PATCH repos/o/r/issues/3 -f 'labels[]=owner-approved' | le label d’approbation est posé par le propriétaire seul |
      | gh api -XPOST repos/o/r/issues/3/labels/owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh api repos/o/r/issues/3/labels -X GET -f labels[]=owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh api --method PATCH repos/o/r/issues/3 --input body.json | le label d’approbation est posé par le propriétaire seul |
      | gh api repos/o/r/issues/3/labels --input body.json | le label d’approbation est posé par le propriétaire seul |
      | gh api graphql --input q.json | le label d’approbation est posé par le propriétaire seul |
      | gh api /graphql -F query=@q.graphql | le label d’approbation est posé par le propriétaire seul |
      | gh api graphql -f query='mutation{addLabelsToLabelable(input:{labelableId:"X",labelIds:["L"]}){clientMutationId}}' | le label d’approbation est posé par le propriétaire seul |
      | gh api graphql -f query='mutation { updatePullRequest(input: {pullRequestId: "PR_1", labelIds: ["LA_1"]}) { clientMutationId } }' | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label LA_kwDOSA6XCs8AAAADFHHJsw | le label d’approbation est posé par le propriétaire seul |
      | GH_TOKEN=x gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | GH_HOST=x gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | command gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | env -i gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | /usr/local/bin/gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | bash -c 'gh pr edit 3 --add-label owner-approved' | le label d’approbation est posé par le propriétaire seul |
      | sh -c "gh pr edit 3 --add-label owner-approved" | le label d’approbation est posé par le propriétaire seul |
      | python3 -c 'import subprocess; subprocess.run(["gh","pr","edit","3","--add-label","owner-approved"])' | le label d’approbation est posé par le propriétaire seul |
      | curl -X POST -H 'Authorization: token x' https://api.github.com/repos/o/r/issues/3/labels -d '{"labels":["owner-approved"]}' | le label d’approbation est posé par le propriétaire seul |
      | wget --post-data='{"labels":["owner-approved"]}' https://api.github.com/repos/o/r/issues/3/labels | le label d’approbation est posé par le propriétaire seul |
      | gh alias set ok 'pr edit --add-label owner-approved' | le label d’approbation est posé par le propriétaire seul |
      | gh label edit approved --name owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh label create owner-approved | le label d’approbation est posé par le propriétaire seul |
      | echo 'ok: pr edit --add-label owner-approved' >> ~/.config/gh/config.yml | le label d’approbation est posé par le propriétaire seul |
      | printf 'aliases:\\n  ok: pr edit --add-label owner-approved\\n' > ~/.config/gh/config.yml | le label d’approbation est posé par le propriétaire seul |
      | cd ~/.config/gh && echo 'ok: pr edit --add-label owner-approved' >> config.yml | le label d’approbation est posé par le propriétaire seul |
      | gh pr view 3 --json labels > ~/.config/gh/hosts.yml; echo owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr view 3 ; gh pr edit 3 --add-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | cd $(gh pr edit 3 --add-label owner-approved) | le label d’approbation est posé par le propriétaire seul |
      | echo `gh pr edit 3 --add-label owner-approved` | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label "$(cat f)" | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label $(<f) | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label $(echo b3duZXItYXBwcm92ZWQ= \| base64 -d) | le label d’approbation est posé par le propriétaire seul |
      | gh pr view 3 --json labels \| jq '.labels[]\|select(.name=="owner-approved")' | le label d’approbation est posé par le propriétaire seul |
      | timeout 20 gh pr view 3 --json labels \| grep owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --title 'label owner-approved' | le label d’approbation est posé par le propriétaire seul |
      | gh pr comment 3 --body 'the owner-approved label is set by the owner' | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --remove-label owner-approved | le label d’approbation est posé par le propriétaire seul |
      | gh pr edit 3 --add-label owner-approved; gh pr view 3 | le label d’approbation est posé par le propriétaire seul |

  Scenario Outline: a merge belongs to the automaton: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | gh pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh pr merge | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh pr merge 12 --auto --squash | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh -R cdeust/architect-os pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh --repo o/r pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh pr --repo o/r merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | env -i gh pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | env GH_REPO=o/r gh pr merge 7 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | /opt/homebrew/bin/gh pr merge 7 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | sh -c 'gh pr merge 12' | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | bash -c "cd x && gh pr merge 12" | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | true \| gh pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | timeout 30 gh pr merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | \\gh pr mer\\ge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | 'gh' pr 'merge' 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh  pr  merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh pr ⏎merge 12 | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh api -X PUT repos/cdeust/architect-os/pulls/12/merge | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/o/r/pulls/12/merge | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh api graphql -f query='mutation { mergePullRequest(input: {}) { x } }' | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh api graphql -f query='mutation { enablePullRequestAutoMerge(x) { y } }' | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | gh alias set m 'pr merge' | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |

  Scenario Outline: an administrator bypass is refused: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | gh pr merge 12 --admin | le contournement administrateur est refusé |
      | gh pr merge --admin 12 | le contournement administrateur est refusé |
      | gh pr merge 12 --admin=true | le contournement administrateur est refusé |
      | gh -R o/r pr merge 1 --admin | le contournement administrateur est refusé |
      | gh pr view 1 --admin | le contournement administrateur est refusé |

  Scenario Outline: an update of a branch by the forge is refused: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | gh pr update-branch 12 | la mise à jour de branche par la forge est refusée |
      | gh -R o/r pr update-branch 12 | la mise à jour de branche par la forge est refusée |
      | gh api -X PUT repos/o/r/pulls/12/update-branch | la mise à jour de branche par la forge est refusée |
      | gh pr view 12 ; gh pr update-branch 12 | la mise à jour de branche par la forge est refusée |

  Scenario Outline: a push to a protected branch is refused, even beside another command: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | git push origin main | la poussée directe sur une branche protégée est refusée |
      | git push origin HEAD:main | la poussée directe sur une branche protégée est refusée |
      | git push origin +x:refs/heads/main | la poussée directe sur une branche protégée est refusée |
      | git push origin +main | la poussée directe sur une branche protégée est refusée |
      | git push origin HEAD:feat/gate-1a | la poussée directe sur une branche protégée est refusée |
      | git push origin 'HEAD:main' | la poussée directe sur une branche protégée est refusée |
      | git -c core.x=y push origin main | la poussée directe sur une branche protégée est refusée |
      | npm test && git push origin main | la poussée directe sur une branche protégée est refusée |
      | git push origin feature && git log origin/main | la poussée directe sur une branche protégée est refusée |

  Scenario Outline: what a session does every day goes through: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | gh pr create --title t --body b | through |
      | gh pr create --title t --body-file b.md --label bug | through |
      | gh pr view 12 --json mergeable,mergeStateStatus | through |
      | gh pr view 3 --json labels | through |
      | gh pr view 3 --comments | through |
      | gh pr checks 12 | through |
      | gh pr checks 3 --watch | through |
      | gh run watch 123 --exit-status | through |
      | gh run list --branch x | through |
      | gh pr list --label owner-approved | through |
      | gh issue list --label owner-approved | through |
      | gh pr list --search label:owner-approved | through |
      | gh label list | through |
      | gh -R o/r pr view 7 | through |
      | gh api repos/o/r/issues/7 | through |
      | gh api repos/cdeust/architect-os/pulls/12 | through |
      | gh pr comment 3 --body x | through |
      | gh pr comment 3 --body-file reply.md | through |
      | grep -rn owner-approved docs \| head | through |
      | git commit -m 'refuse the owner-approved label' | through |
      | git commit -F msg.txt | through |
      | git merge --no-ff topic | through |
      | git merge-tree a b | through |
      | git push origin HEAD:exigences-prompts-retires | through |
      | git push origin main-fix | through |
      | git push origin HEAD:refs/heads/main/x | through |
      | git log origin/main -1 | through |
      | npm run deliver -- name | through |
      | gh pr edit 3 --add-label claude-rereview | through |
      | gh pr edit 3 --add-label ownerapproved | through |

  Scenario Outline: declared in the design, §5, as what the guard does not see: <command>
    Then the session guard reads the command «<command>» as «<reason>»

    Examples:
      | command | reason |
      | xargs -a f.txt gh pr edit 3 --add-label | through |
      | gh ok 3 | through |
      | GH_CONFIG_DIR=/tmp/x gh ok 3 | through |
      | bash x.sh | through |
      | curl -K cfg.txt | through |
      | python3 -c 'import urllib.request' | through |
      | gh extension exec x | through |

  Scenario Outline: the call as Claude Code gives it: <json>
    Then the session guard reads the call '<json>' as "<reason>"

    Examples:
      | json | reason |
      | {"tool_name":"mcp__github__merge_pull_request","tool_input":{"pullNumber":12}} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | {"tool_name":"mcp__github_remote__merge_pull_request","tool_input":{}} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | {"tool_name":"mcp__plugin_github_github__merge_pull_request","tool_input":{}} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | {"tool_name":"mcp__github__enable_pull_request_auto_merge","tool_input":{}} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | {"tool_name":"mcp__github__update_pull_request_branch","tool_input":{}} | la mise à jour de branche par la forge est refusée |
      | {"tool_name":"mcp__github__issue_write","tool_input":{"labels":["owner-approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__issue_write","tool_input":{"labels":["Owner-Approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__GitHub__issue_write","tool_input":{"labels":["x"],"body":"LA_kwDOSA6XCs8AAAADFHHJsw"}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github_remote__issue_write","tool_input":{"labels":["owner-approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__plugin_github_github__issue_write","tool_input":{"labels":["owner-approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__update_pull_request","tool_input":{"labels":["bug","owner-approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__pull_request_review_write","tool_input":{"labels":["owner-approved"]}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__issue_read","tool_input":{"q":"owner-approved"}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__add_issue_comment","tool_input":{"body":"owner-approved"}} | le label d’approbation est posé par le propriétaire seul |
      | {"tool_name":"mcp__github__create_pull_request","tool_input":{"title":"t"}} | through |
      | {"tool_name":"mcp__github__pull_request_read","tool_input":{"pullNumber":12}} | through |
      | {"tool_name":"mcp__github__update_pull_request","tool_input":{"title":"x"}} | through |
      | {"tool_name":"mcp__semantica__record_decision","tool_input":{"text":"merge owner-approved"}} | through |
      | {"tool_name":"Edit","tool_input":{"content":"gh pr edit 1 --add-label owner-approved"}} | through |
      | {"tool_name":"Write","tool_input":{"content":"gh pr merge 1"}} | through |
      | {"tool_name":"not_mcp__github__merge_pull_request","tool_input":{}} | through |
      | {"tool_name":"Bash","tool_input":{"command":"gh pr merge 1"}} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | {"tool_name":"Bash","tool_input":{"command":"gh pr view 1"}} | through |
      | {"tool_name":"Bash","tool_input":{}} | appel illisible |
      | {"tool_name":"Bash"} | appel illisible |
      | {"tool_name":"Bash","tool_input":{"command":1}} | appel illisible |
      | {"tool_input":{"command":"ls"}} | appel illisible |
      | {"tool_name":["Bash"]} | appel illisible |
      | "gh pr merge 1" | appel illisible |
      | null | appel illisible |
      | {"tool_name":"mcp__github__merge_pull_request"} | la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |

  Scenario Outline: the hook exits with 2 and one line on stderr to block, with 0 and nothing to let through: <case>
    When the session guard is given the stdin '<stdin>'
    Then the session guard exits with <code> and writes "<stderr>"

    Examples:
      | case           | stdin                                                         | code | stderr                                                                                                  |
      | a merge        | {"tool_name":"Bash","tool_input":{"command":"gh pr merge 1"}} | 2    | architect-os session-guard: la fusion appartient à l’automate du dépôt, sur approbation du propriétaire |
      | a read         | {"tool_name":"Bash","tool_input":{"command":"gh pr view 1"}}  | 0    |                                                                                                         |
      | not JSON       | gh pr merge 1                                                 | 2    | architect-os session-guard: appel illisible                                                             |
      | an empty stdin |                                                               | 2    | architect-os session-guard: appel illisible                                                             |

  Scenario: a stdin that cannot be read blocks the call
    When the session guard cannot read its stdin
    Then the session guard exits with 2 and writes "architect-os session-guard: appel illisible"

  Scenario: the hook reads its stdin whole as UTF-8 from file descriptor 0, and writes to the stderr of the process
    Then the dependencies of the session guard read file descriptor 0 as "utf8" and keep the stderr of the process

  Scenario: a call is read as the shell reads a word: quotes and backslashes removed, lower case, blanks folded
    Then the session guard normalizes «  'GH'⇥pr  "Mer\\ge"  12 ⏎» as «gh pr merge 12»
