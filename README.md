# Guitar Pro Player

Desktop player for Guitar Pro scores with notation, track controls and built-in sound libraries.

## Features

- Opens `.gp`, `.gp3`, `.gp4`, `.gp5`, `.gp6`, `.gp7` and `.gpx` files.
- Displays notation and tablature for individual tracks.
- Plays scores with built-in SF2/SF3 sound libraries.
- Track visibility, mute, solo, volume, panorama and instrument selection.
- Measure timeline navigation.
- Windows file associations for opening scores by double-click.

## Development

```powershell
pnpm install
pnpm run dev
```

## Windows build

```powershell
pnpm run dist
```

The build produces an NSIS installer and a portable executable.
