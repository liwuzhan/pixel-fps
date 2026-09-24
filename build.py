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
    ('CONTENT', 'game/content.js'), ('INVENTORY', 'game/inventory.js'),
    ('WORLD', 'game/world.js'), ('SKILL_RUNTIME', 'game/skill-runtime.js'),
    ('SKILLS', None), ('ITEM_VISUALS', 'game/item-visuals.js'),
    ('GAME_RENDERER', 'game/renderer.js'),
    ('LAB', 'game/lab.js'), ('LAB_PANEL', 'game/lab-panel.js'),
    ('PLAYER_ACTIONS', 'game/player-actions.js'), ('INVENTORY_PANEL', 'game/inventory-panel.js'),
    ('GAME_APP', 'game/app.js'),
]
for token, name in game_files:
    content = ('\n'.join(path.read_text(encoding='utf-8') for path in sorted((src / 'skills').glob('*.js')))
               if token == 'SKILLS' else (src / name).read_text(encoding='utf-8'))
    if token != 'GAME_STYLE':
        content = content.replace('</script', '<\\/script')
    game = game.replace('/* INLINE_' + token + ' */', content)
(root / 'index.html').write_text(game, encoding='utf-8')
print(root / 'index.html')
