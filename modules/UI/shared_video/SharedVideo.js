/* global $, APP, YT, interfaceConfig, onPlayerReady, onPlayerStateChange,
onPlayerError */

import Logger from 'jitsi-meet-logger';

import {
    createSharedVideoEvent as createEvent,
    sendAnalytics
} from '../../../react/features/analytics';
import {
    participantJoined,
    participantLeft,
    pinParticipant
} from '../../../react/features/base/participants';

//TODO VIDEO_PLAYER_PARTICIPANT_NAME => VIDEO_PLAYER_PARTICIPANT_NAME2
import { VIDEO_PLAYER_PARTICIPANT_NAME } from '../../../react/features/shared-video2/constants';
import { dockToolbox, showToolbox } from '../../../react/features/toolbox/actions.web';
import { getToolboxHeight } from '../../../react/features/toolbox/functions.web';
import UIEvents from '../../../service/UI/UIEvents';
import Filmstrip from '../videolayout/Filmstrip';
import LargeContainer from '../videolayout/LargeContainer';
import VideoLayout from '../videolayout/VideoLayout';

import { PeerTubePlayer } from '@peertube/embed-api'

const logger = Logger.getLogger(__filename);

export const SHARED_VIDEO_CONTAINER_TYPE = 'sharedvideo2';

/**
 * Example shared video link.
 * @type {string}
 */
const updateInterval = 500; // milliseconds


/**
 * Manager of shared video.
 */
//TODO
export default class SharedVideoManager {
    /**
     *
     */
    constructor(emitter) {
        this.emitter = emitter;
        this.isSharedVideoShown = false;     
        this.isPlayerAPILoaded = false;  
        this.mutedWithUserInteraction = false;
    }

    /**
     * Indicates if the player volume is currently on. This will return true if
     * we have an available player, which is currently in a PLAYING state,
     * which isn't muted and has it's volume greater than 0.
     *
     * @returns {boolean} indicating if the volume of the shared video is
     * currently on.
     */
    isSharedVideoVolumeOn() {
        return this.player
                && this.player.getPlayerState() === YT.PlayerState.PLAYING
                && !this.player.isMuted()
                && this.player.getVolume() > 0;
    }

    /**
     * Indicates if the local user is the owner of the shared video.
     * @returns {*|boolean}
     */
    isSharedVideoOwner() {
        return this.from && APP.conference.isLocalId(this.from);
    }

    /**
     * Start shared video event emitter if a video is not shown.
     *
     * @param url of the video
     */
    startSharedVideoEmitter(url) {

        if (!this.isSharedVideoShown) {
            if (url) {
                this.emitter.emit(
                    UIEvents.UPDATE_SHARED_VIDEO, url, 'start');
                sendAnalytics(createEvent('started'));
            }

            logger.log('SHARED VIDEO CANCELED');
            sendAnalytics(createEvent('canceled'));
        }
    }

    /**
     * Stop shared video event emitter done by the one who shared the video.
     */
    stopSharedVideoEmitter() {

        if (APP.conference.isLocalId(this.from)) {
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
            this.emitter.emit(
                UIEvents.UPDATE_SHARED_VIDEO, this.url, 'stop');
            sendAnalytics(createEvent('stopped'));
        }
    }

    /**
     * Shows the player component and starts the process that will be sending
     * updates, if we are the one shared the video.
     *
     * @param id the id of the sender of the command
     * @param url the video url
     * @param attributes
     */
    onSharedVideoStart(id, url, attributes) {
        if (this.isSharedVideoShown) {
            return;
        }

        this.isSharedVideoShown = true;

        // the video url
        this.url = url;

       
        // the owner of the video
        this.from = id;


        this.mutedWithUserInteraction = APP.conference.isLocalAudioMuted();

        // listen for local audio mute events
        this.localAudioMutedListener = this.onLocalAudioMuted.bind(this);
        this.emitter.on(UIEvents.AUDIO_MUTED, this.localAudioMutedListener);


        this.initialAttributes = attributes;
        const self = this;
              
        
        //HACKATHON TIME!

        //from https://peer.tube/videos/watch/18cc9866-ea53-426c-bef2-b84880406038
        //to   https://peer.tube/videos/embed/18cc9866-ea53-426c-bef2-b84880406038?autoplay=0&controls=(showControls)&api=1


        const iframeCreated = document.createElement('iframe');
        const showControls = APP.conference.isLocalId(self.from) ? 1 : 0;

        iframeCreated.src = 'https://peer.tube/videos/embed/' + url + '?autoplay=0&controls=' + showControls + '&api=1';        
        iframeCreated.id ='peerTubeIFrame';
        document.querySelector('#sharedVideo').appendChild(iframeCreated);        
                     
      

        const p = new PeerTubePlayer(document.querySelector('iframe'));
        window.player = p;
       

        //according to docs https://docs.joinpeertube.org/api-embed-player
        // we should be doing this
        //        
        //await player.ready
        //
        //but it is synchronous (bad user exp. due to waiting times), so I do:

               
        p.ready.then(() =>{

            logger.log("p is ready.");

            self.isPlayerAPILoaded = true;  
                            
            //TODO there should be more events such as volume control          

            p.addEventListener(
                'playbackStatusChange', 'playbackStatusChange');         


            const player = window.player;
       

            player.play();
            //player.pause();
            
            const iframe = document.querySelector('#peerTubeIFrame');
         
            console.log(iframe);

            // eslint-disable-next-line no-use-before-define
            self.sharedVideo2 = new SharedVideoContainer(
                { url,
                    iframe,
                    player });

            // prevents pausing participants not sharing the video
            // to pause the video
            if (!APP.conference.isLocalId(self.from)) {
                $('#sharedVideo').css('pointer-events', 'none');
            }

            VideoLayout.addLargeVideoContainer(
                SHARED_VIDEO_CONTAINER_TYPE, self.sharedVideo2);

            APP.store.dispatch(participantJoined({

                // FIXME The cat is out of the bag already or rather _room is
                // not private because it is used in multiple other places
                // already such as AbstractPageReloadOverlay.
                conference: APP.conference._room,
                id: self.url,
                isFakeParticipant: true,
                //TODO VIDEO_PLAYER_PARTICIPANT_NAME => VIDEO_PLAYER_PARTICIPANT_NAME2
                //name: VIDEO_PLAYER_PARTICIPANT_NAME
                name: 'PeerTube'
            }));

            APP.store.dispatch(pinParticipant(self.url));

            // If we are sending the command and we are starting the player
            // we need to continuously send the player current time position
            if (APP.conference.isLocalId(self.from)) {
                self.intervalId = setInterval(
                    self.fireSharedVideoEvent.bind(self),
                    updateInterval);
            }

        });
        
    }

    /**
     * Process attributes, whether player needs to be paused or seek.
     * @param player the player to operate over
     * @param attributes the attributes with the player state we want
     */
    processVideoUpdate(player, attributes) {
        if (!attributes) {
            return;
        }

        // eslint-disable-next-line eqeqeq
        if (attributes.state == 'playing') {

            const isPlayerPaused
                = this.player.getPlayerState() === YT.PlayerState.PAUSED;

            // If our player is currently paused force the seek.
            this.processTime(player, attributes, isPlayerPaused);

            // Process mute.
            const isAttrMuted = attributes.muted === 'true';

            if (player.isMuted() !== isAttrMuted) {
                this.smartPlayerMute(isAttrMuted, true);
            }

            // Process volume
            if (!isAttrMuted
                && attributes.volume !== undefined
                // eslint-disable-next-line eqeqeq
                && player.getVolume() != attributes.volume) {

                player.setVolume(attributes.volume);
                logger.info(`Player change of volume:${attributes.volume}`);
            }

            if (isPlayerPaused) {
                player.playVideo();
            }
            // eslint-disable-next-line eqeqeq
        } else if (attributes.state == 'pause') {
            // if its not paused, pause it
            player.pauseVideo();

            this.processTime(player, attributes, true);
        }
    }

    /**
     * Check for time in attributes and if needed seek in current player
     * @param player the player to operate over
     * @param attributes the attributes with the player state we want
     * @param forceSeek whether seek should be forced
     */
    processTime(player, attributes, forceSeek) {
        if (forceSeek) {
            logger.info('Player seekTo:', attributes.time);
            player.seekTo(attributes.time);

            return;
        }

        // check received time and current time
        const currentPosition = player.getCurrentTime();
        const diff = Math.abs(attributes.time - currentPosition);

        // if we drift more than the interval for checking
        // sync, the interval is in milliseconds
        if (diff > updateInterval / 1000) {
            logger.info('Player seekTo:', attributes.time,
                ' current time is:', currentPosition, ' diff:', diff);
            player.seekTo(attributes.time);
        }
    }

    /**
     * Checks current state of the player and fire an event with the values.
     */
    fireSharedVideoEvent(sendPauseEvent) {
        // ignore update checks if we are not the owner of the video
        // or there is still no player defined or we are stopped
        // (in a process of stopping)
        if (!APP.conference.isLocalId(this.from) || !this.player
            || !this.isSharedVideoShown) {
            return;
        }

        const state = this.player.getPlayerState();

        // if its paused and haven't been pause - send paused

        if (state === YT.PlayerState.PAUSED && sendPauseEvent) {
            this.emitter.emit(UIEvents.UPDATE_SHARED_VIDEO,
                this.url, 'pause', this.player.getCurrentTime());
        } else if (state === YT.PlayerState.PLAYING) {
            // if its playing and it was paused - send update with time
            // if its playing and was playing just send update with time
            this.emitter.emit(UIEvents.UPDATE_SHARED_VIDEO,
                this.url, 'playing',
                this.player.getCurrentTime(),
                this.player.isMuted(),
                this.player.getVolume());
        }
    }

    /**
     * Updates video, if it's not playing and needs starting or if it's playing
     * and needs to be paused.
     * @param id the id of the sender of the command
     * @param url the video url
     * @param attributes
     */
    onSharedVideoUpdate(id, url, attributes) {
        // if we are sending the event ignore
        if (APP.conference.isLocalId(this.from)) {
            return;
        }

        if (!this.isSharedVideoShown) {
            this.onSharedVideoStart(id, url, attributes);

            return;
        }

        // eslint-disable-next-line no-negated-condition
        if (!this.player) {
            this.initialAttributes = attributes;
        } else {
            this.processVideoUpdate(this.player, attributes);
        }
    }

    /**
     * Stop shared video if it is currently showed. If the user started the
     * shared video is the one in the id (called when user
     * left and we want to remove video if the user sharing it left).
     * @param id the id of the sender of the command
     */
    onSharedVideoStop(id, attributes) {
        if (!this.isSharedVideoShown) {
            return;
        }

        if (this.from !== id) {
            return;
        }

        if (!this.player) {
            // if there is no error in the player till now,
            // store the initial attributes
            if (!this.errorInPlayer) {
                this.initialAttributes = attributes;

                return;
            }
        }

        this.emitter.removeListener(UIEvents.AUDIO_MUTED,
            this.localAudioMutedListener);
        this.localAudioMutedListener = null;

        APP.store.dispatch(participantLeft(this.url, APP.conference._room));

        VideoLayout.showLargeVideoContainer(SHARED_VIDEO_CONTAINER_TYPE, false)
            .then(() => {
                VideoLayout.removeLargeVideoContainer(
                    SHARED_VIDEO_CONTAINER_TYPE);

                if (this.player) {
                    this.player.destroy();
                    this.player = null;
                } else if (this.errorInPlayer) {
                    // if there is an error in player, remove that instance
                    this.errorInPlayer.destroy();
                    this.errorInPlayer = null;
                }
                this.smartAudioUnmute();

                // revert to original behavior (prevents pausing
                // for participants not sharing the video to pause it)
                $('#sharedVideo').css('pointer-events', 'auto');

                this.emitter.emit(
                    UIEvents.UPDATE_SHARED_VIDEO, null, 'removed');
            });

        this.url = null;
        this.isSharedVideoShown = false;
        this.initialAttributes = null;
    }

    /**
     * Receives events for local audio mute/unmute by local user.
     * @param muted boolena whether it is muted or not.
     * @param {boolean} indicates if this mute was a result of user interaction,
     * i.e. pressing the mute button or it was programmatically triggered
     */
    onLocalAudioMuted(muted, userInteraction) {
        if (!this.player) {
            return;
        }

        if (muted) {
            this.mutedWithUserInteraction = userInteraction;
        } else if (this.player.getPlayerState() !== YT.PlayerState.PAUSED) {
            this.smartPlayerMute(true, false);

            // Check if we need to update other participants
            this.fireSharedVideoEvent();
        }
    }

    /**
     * Mutes / unmutes the player.
     * @param mute true to mute the shared video, false - otherwise.
     * @param {boolean} Indicates if this mute is a consequence of a network
     * video update or is called locally.
     */
    smartPlayerMute(mute, isVideoUpdate) {
        if (!this.player.isMuted() && mute) {
            this.player.mute();

            if (isVideoUpdate) {
                this.smartAudioUnmute();
            }
        } else if (this.player.isMuted() && !mute) {
            this.player.unMute();
            if (isVideoUpdate) {
                this.smartAudioMute();
            }
        }
    }

    /**
     * Smart mike unmute. If the mike is currently muted and it wasn't muted
     * by the user via the mike button and the volume of the shared video is on
     * we're unmuting the mike automatically.
     */
    smartAudioUnmute() {
        if (APP.conference.isLocalAudioMuted()
            && !this.mutedWithUserInteraction
            && !this.isSharedVideoVolumeOn()) {
            sendAnalytics(createEvent('audio.unmuted'));
            logger.log('Shared video: audio unmuted');
            this.emitter.emit(UIEvents.AUDIO_MUTED, false, false);
        }
    }

    /**
     * Smart mike mute. If the mike isn't currently muted and the shared video
     * volume is on we mute the mike.
     */
    smartAudioMute() {
        if (!APP.conference.isLocalAudioMuted()
            && this.isSharedVideoVolumeOn()) {
            sendAnalytics(createEvent('audio.muted'));
            logger.log('Shared video: audio muted');
            this.emitter.emit(UIEvents.AUDIO_MUTED, true, false);
        }
    }
}

/**
 * Container for shared video iframe.
 */
class SharedVideoContainer extends LargeContainer {
    /**
     *
     */
    constructor({ url, iframe, player }) {
        super();

        this.$iframe = $(iframe);
        this.url = url;
        this.player = player;
    }

    /**
     *
     */
    show() {
        const self = this;


        return new Promise(resolve => {
            this.$iframe.fadeIn(300, () => {
                self.bodyBackground = document.body.style.background;
                document.body.style.background = 'black';
                this.$iframe.css({ opacity: 1 });
                APP.store.dispatch(dockToolbox(true));
                resolve();
            });
        });
    }

    /**
     *
     */
    hide() {
        const self = this;

        APP.store.dispatch(dockToolbox(false));

        return new Promise(resolve => {
            this.$iframe.fadeOut(300, () => {
                document.body.style.background = self.bodyBackground;
                this.$iframe.css({ opacity: 0 });
                resolve();
            });
        });
    }

    /**
     *
     */
    onHoverIn() {
        APP.store.dispatch(showToolbox());
    }

    /**
     *
     */
    get id() {
        return this.url;
    }

    /**
     *
     */
    resize(containerWidth, containerHeight) {
        let height, width;

        if (interfaceConfig.VERTICAL_FILMSTRIP) {
            height = containerHeight - getToolboxHeight();
            width = containerWidth - Filmstrip.getVerticalFilmstripWidth();
        } else {
            height = containerHeight - Filmstrip.getFilmstripHeight();
            width = containerWidth;
        }

        this.$iframe.width(width).height(height);
    }

    /**
     * @return {boolean} do not switch on dominant speaker event if on stage.
     */
    stayOnStage() {
        return false;
    }
}
