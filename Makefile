schemas:
	mkdir -p simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/schemas
	glib-compile-schemas --targetdir=simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/schemas/ simulate-switching-workspaces-on-active-monitor@micheledaros.com/schemas/

build:
	cd simulate-switching-workspaces-on-active-monitor@micheledaros.com/ && npm run build

copy-assets:
	mkdir -p simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/
	cp simulate-switching-workspaces-on-active-monitor@micheledaros.com/metadata.json simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/

submit: schemas build copy-assets
	cd simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/ && zip -r ~/simulate-switching-workspaces-on-active-monitor.zip *

install:
	rm -rf ~/.local/share/gnome-shell/extensions/simulate-switching-workspaces-on-active-monitor@micheledaros.com/
	cp -r simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/ ~/.local/share/gnome-shell/extensions/simulate-switching-workspaces-on-active-monitor@micheledaros.com/
