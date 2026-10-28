Caption engine port from the user-installed Frameloom app, inspected 2026-10-27.
Source: app/vidgen/captions.py and app/tools/fonts.
Source app remains unmodified. Animation events, phrase grouping, fonts,
resolution scaling, margins and color behavior are retained. Optional in-memory
word timing input, custom accent/font/size/case/y-offset adapt the engine to VEO3.
Preview and final export both call video_editing.build_captions.
Legacy Video Automation caption presets remain available separately.
