# Customs Night companion

This little app watches your League client and tells the bot who is in the lobby and who won, so nobody
has to pick teams or report scores. It only reads the client — it never plays for you and never clicks
anything in a game.

## 1. Download it

Get `CustomsNight.exe` from the link in the group chat and put it somewhere you will find it again. Your
desktop is fine.

Windows may say it does not recognise the app. Click **More info**, then **Run anyway**. It says that
about anything that is not from a big company.

## 2. Paste your token

Double-click it. The first time, it asks for a token. If it is your first time, join one of our custom
lobbies first so the bot knows you exist, then ask for the token. Whoever runs the admin page makes one for
you and sends it over — ask them for it. Paste it in and press Enter. You will not see it as you type; that
is on purpose.

It remembers the token, so this is the only time you do this.

## 3. Leave it running

That is the whole job. Play League as usual. When you are in a custom lobby with the others, the teams
show up in Discord on their own, and the result lands on the site when the game ends.

Keep the window open while you play. Closing it breaks nothing — you just stop being the one reporting —
but if nobody has it open when a game ends, that game is not counted.

## If something looks wrong

The app writes down everything it did. Press Windows+R, paste `%APPDATA%\customs-night\logs`, press
Enter, and send the newest file to whoever set this up. There are no passwords in it.

Your token is in `%APPDATA%\customs-night\config.json`. Do not paste that file anywhere; it is yours.
