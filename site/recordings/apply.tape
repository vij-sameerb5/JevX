Output apply.gif
Set Shell zsh
Set FontFamily "JetBrains Mono"
Set FontSize 14
Set Width 1200
Set Height 820
Set Theme { "background": "#151312", "foreground": "#e9e3dc", "cursor": "#d9784f" }
Hide
Type "D=$(mktemp -d) && cp -R ~/Desktop/jevX/examples/jev-demo/. $D && cd $D && git init -q && git add -A && git commit -qm demo && clear" Enter
Show
Type "jevx --yes --min-fit 65" Sleep 400ms Enter
Sleep 180s
Type "git diff --stat" Sleep 300ms Enter
Sleep 3s
