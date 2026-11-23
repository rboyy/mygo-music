package app

import (
	"time"

	"github.com/egoist/mygo"

	"mygo-music/internal/music"
	"mygo-music/internal/player"
	"mygo-music/internal/plugin"
)

// pluginPlayer is the app's player as a plugin sees it through host.player.
// Plugins run off the main thread, so each call waits for the main thread to
// answer from the player, which only it touches.
type pluginPlayer struct{ a *app }

func (pp pluginPlayer) onMain(fn func()) {
	// Without a window, as in tests, there's no main thread to wait on, and
	// a.post would drop fn: do it here.
	if pp.a.win == nil {
		fn()
		return
	}
	done := make(chan struct{})
	mygo.RunOnMain(func() {
		fn()
		close(done)
	})
	<-done
}

func (pp pluginPlayer) State() music.PlayerState {
	var st music.PlayerState
	pp.onMain(func() {
		p := pp.a.pl
		if p == nil {
			return
		}
		st = music.PlayerState{
			Playing:  p.Playing(),
			Position: int64(p.Position() / time.Millisecond),
			Duration: int64(p.Duration() / time.Millisecond),
			Repeat:   repeatName(p.Repeat()),
			Shuffle:  p.Shuffle(),
		}
		if t := p.Current(); t != nil {
			st.TrackID = t.ID
			st.Source = t.Source
			st.Name = t.Name
			st.Artist = t.ArtistNames()
		}
	})
	return st
}

func (pp pluginPlayer) Pause() {
	pp.onMain(func() {
		p := pp.a.pl
		if p == nil {
			return
		}
		if p.Playing() || p.Loading() {
			p.TogglePlay()
		}
	})
}

func (pp pluginPlayer) Resume() {
	pp.onMain(func() {
		p := pp.a.pl
		if p == nil {
			return
		}
		if !p.Playing() && p.Current() != nil {
			p.TogglePlay()
		}
	})
}

func repeatName(r player.RepeatMode) string {
	switch r {
	case player.RepeatAll:
		return "all"
	case player.RepeatOne:
		return "one"
	}
	return "off"
}

var _ plugin.Player = pluginPlayer{}
