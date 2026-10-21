#!/usr/bin/env python3
"""Ship the music of the original into the client.

The nine tracks of music.exe (a RAR archive the NetStorm community distributes; extract it into
original/game/Netstorm/music) are plain WAV files named .mus: 16-bit stereo PCM at 22 050 Hz.
This converts them to MP3 for the browser with ffmpeg.

Usage: music.py <original/game/Netstorm/music> <packages/client/public/music>
"""
import pathlib
import subprocess
import sys

BITRATE = '96k'


def main() -> None:
    source, target = map(pathlib.Path, sys.argv[1:3])
    target.mkdir(parents=True, exist_ok=True)
    for track in sorted(source.glob('*.mus')):
        out = target / (track.stem.lower() + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'wav', '-i', str(track), '-b:a', BITRATE,
                        str(out)], check=True)
        print(out.name, out.stat().st_size)


if __name__ == '__main__':
    main()
