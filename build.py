"""Build the character editor and the offline FPS demo without dependencies."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
src = root / 'src'
html = (src / 'shell.html').read_text(encoding='utf-8')
for token, name in [('STYLE', 'style.css'), ('CHARACTER', 'character.js'), ('VIEWPORT', 'viewport.js'), ('PAINTER', 'face-painter.js'), ('APP', 'app.js')]:
    content = (src / name).read_text(encoding='utf-8')
    if token != 'STYLE':
        content = content.replace('</script', '<\\/script')
    html = html.replace('/* INLINE_' + token + ' */', content)
(root / 'block-character.html').write_text(html, encoding='utf-8')
print(root / 'block-character.html')

game = (src / 'game/shell.html').read_text(encoding='utf-8')
game = game.replace('/* INLINE_STUDIO_DOCUMENT */', json.dumps(html, ensure_ascii=False).replace('</', '<\\/'))
game_files = [
    ('GAME_STYLE', 'game/style.css'), ('CHARACTER', 'character.js'),
    ('WORLD', 'game/world.js'), ('SKILL_RUNTIME', 'game/skill-runtime.js'),
    ('JETPACK', 'skills/jetpack.js'), ('AUTOAIM', 'skills/autoaim.js'),
    ('WEAKEN', 'skills/weaken.js'), ('GAME_RENDERER', 'game/renderer.js'),
    ('LAB', 'game/lab.js'), ('LAB_PANEL', 'game/lab-panel.js'),
    ('GAME_APP', 'game/app.js'),
]
for token, name in game_files:
    content = (src / name).read_text(encoding='utf-8')
    if token != 'GAME_STYLE':
        content = content.replace('</script', '<\\/script')
    game = game.replace('/* INLINE_' + token + ' */', content)
(root / 'index.html').write_text(game, encoding='utf-8')
print(root / 'index.html')
