#!/bin/bash

INPUT_DIR="_raw_videos"
OUTPUT_DIR="seamless_videos"

mkdir -p "$OUTPUT_DIR"

for file in "$INPUT_DIR"/*.{mp4,mov,MP4,MOV}; do
    # Check if file exists to handle cases where no files match the glob
    [ -f "$file" ] || continue

    filename=$(basename "$file")
    echo "Processing $filename..."

    # Get duration of the video in seconds using ffprobe
    duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file")
    
    # Calculate the offset for the setpts filter (duration - 1)
    offset=$(echo "$duration - 1" | bc)

    # Run the ffmpeg command with the dynamic offset
    ffmpeg -y -i "$file" -filter_complex \
    "[0]scale=trunc(iw/2)*2:trunc(ih/2)*2[scaled]; \
     [scaled]split[body][pre]; \
     [pre]trim=duration=1,format=yuva420p,fade=d=1:alpha=1,setpts=PTS+(${offset}/TB)[jt]; \
     [body]trim=1,setpts=PTS-STARTPTS[main]; \
     [main][jt]overlay" \
    "$OUTPUT_DIR/$filename"

    echo "Finished $filename"
    echo "------------------------"
done
