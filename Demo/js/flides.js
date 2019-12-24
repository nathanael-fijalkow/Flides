// Flides is based on impress.js
// What I did is removing some features I didn't use and added some simple new ones 
// Most of the comments for this file are from impress.js, some are mine
// Here is the MIT License from impress.js
/*
The MIT License (MIT)

Copyright (c) 2011-2016 Bartek Szopka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// MIT License for Flides
 
/*
The MIT License (MIT)

Copyright (c) 2016 Nathanaël Fijalkow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function ( document, window ) {
    'use strict';
    
    // HELPER FUNCTIONS
    
    // `pfx` is a function that takes a standard CSS property name as a parameter
    // and returns it's prefixed version valid for current browser it runs in.
    // The code is heavily inspired by Modernizr http://www.modernizr.com/
    var pfx = (function () {
        
        var style = document.createElement('dummy').style,
            prefixes = 'Webkit Moz O ms Khtml'.split(' '),
            memory = {};
        
        return function ( prop ) {
            if ( typeof memory[ prop ] === "undefined" ) {
                
                var ucProp  = prop.charAt(0).toUpperCase() + prop.substr(1),
                    props   = (prop + ' ' + prefixes.join(ucProp + ' ') + ucProp).split(' ');
                
                memory[ prop ] = null;
                for ( var i in props ) {
                    if ( style[ props[i] ] !== undefined ) {
                        memory[ prop ] = props[i];
                        break;
                    }
                }
            
            }
            
            return memory[ prop ];
        };
    
    })();
    
    // `arraify` takes an array-like object and turns it into real Array
    // to make all the Array.prototype goodness available.
    var arrayify = function ( a ) {
        return [].slice.call( a );
    };
    
    // `css` function applies the styles given in `props` object to the element
    // given as `el`. It runs all property names through `pfx` function to make
    // sure proper prefixed version of the property is used.
    var css = function ( el, props ) {
        var key, pkey;
        for ( key in props ) {
            if ( props.hasOwnProperty(key) ) {
                pkey = pfx(key);
                if ( pkey !== null ) {
                    el.style[pkey] = props[key];
                }
            }
        }
        return el;
    };
    
    // `toNumber` takes a value given as `numeric` parameter and tries to turn
    // it into a number. If it is not possible it returns 0 (or other value
    // given as `fallback`).
    var toNumber = function (numeric, fallback) {
        return isNaN(numeric) ? (fallback || 0) : Number(numeric);
    };
    
    // `byId` returns element with given `id` - you probably have guessed that ;)
    var byId = function ( id ) {
        return document.getElementById(id);
    };
    
    // `$` returns first element for given CSS `selector` in the `context` of
    // the given element or whole document.
    var $ = function ( selector, context ) {
        context = context || document;
        return context.querySelector(selector);
    };
    
    // `$$` return an array of elements for given CSS `selector` in the `context` of
    // the given element or whole document.
    var $$ = function ( selector, context ) {
        context = context || document;
        return arrayify( context.querySelectorAll(selector) );
    };
    
    // `triggerEvent` builds a custom DOM event with given `eventName` and `detail` data
    // and triggers it on element given as `el`.
    var triggerEvent = function (el, eventName, detail) {
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent(eventName, true, true, detail);
        el.dispatchEvent(event);
    };
    
    // `translate` builds a translate transform string for given data.
    var translate = function ( t ) {
        return " translate3d(" + t.x + "px," + t.y + "px," + t.z + "px) ";
    };
    
    // `rotate` builds a rotate transform string for given data.
    // By default the rotations are in X Y Z order that can be reverted by passing `true`
    // as second parameter.
    var rotate = function ( r, revert ) {
        var rX = " rotateX(" + r.x + "deg) ",
            rY = " rotateY(" + r.y + "deg) ",
            rZ = " rotateZ(" + r.z + "deg) ";
        
        return revert ? rZ+rY+rX : rX+rY+rZ;
    };
    
    // `scale` builds a scale transform string for given data.
    var scale = function ( s ) {
        return " scale(" + s + ") ";
    };
    
    // `perspective` builds a perspective transform string for given data.
    var perspective = function ( p ) {
        return " perspective(" + p + "px) ";
    };
    
    // `getElementFromHash` returns an element located by id from hash part of
    // window location.
    var getElementFromHash = function () {
        // get id from url # by removing `#` or `#/` from the beginning,
        // so both "fallback" `#slide-id` and "enhanced" `#/slide-id` will work
        return byId( window.location.hash.replace(/^#\/?/,"") );
    };
    
    // `computeWindowScale` counts the scale factor between window size and size
    // defined for the presentation in the config.
    var computeWindowScale = function ( config ) {
        var hScale = window.innerHeight / config.height,
            wScale = window.innerWidth / config.width,
            scale = hScale > wScale ? wScale : hScale;
        
        if (config.maxScale && scale > config.maxScale) {
            scale = config.maxScale;
        }
        
        if (config.minScale && scale < config.minScale) {
            scale = config.minScale;
        }
        
        return scale;
    };
    
    // CHECK SUPPORT
    var body = document.body;
    
    var ua = navigator.userAgent.toLowerCase();
    var flidesSupported = 
                          // browser should support CSS 3D transtorms 
                           ( pfx("perspective") !== null ) &&
                           
                          // and `classList` and `dataset` APIs
                           ( body.classList ) &&
                           ( body.dataset ) &&
                           
                          // but some mobile devices need to be blacklisted,
                          // because their CSS 3D support or hardware is not
                          // good enough to run flides.js properly, sorry...
                           ( ua.search(/(iphone)|(ipod)|(android)/) === -1 );
    
    if (!flidesSupported) {
        // we can't be sure that `classList` is supported
        body.className += " flides-not-supported ";
    } else {
        body.classList.remove("flides-not-supported");
        body.classList.add("flides-supported");
    }
    
    // GLOBALS AND DEFAULTS
    
    // This is where the root elements of all flides.js instances will be kept.
    // Yes, this means you can have more than one instance on a page, but I'm not
    // sure if it makes any sense in practice ;)
    var roots = {};
    
    // some default config values.
    var defaults = {
        width: 1024,
        height: 768,
        maxScale: 1,
        minScale: 0,
        
        perspective: 1000,
        
        transitionDuration: 1000
    };
    
    // it's just an empty function ... and a useless comment.
    var empty = function () { return false; };
    
    // flides.JS API
    
    // And that's where interesting things will start to happen.
    // It's the core `flides` function that returns the flides.js API
    // for a presentation based on the element with given id ('flides'
    // by default).
    var flides = window.flides = function ( rootId ) {
        
        // If flides.js is not supported by the browser return a dummy API
        // it may not be a perfect solution but we return early and avoid
        // running code that may use features not implemented in the browser.
        if (!flidesSupported) {
            return {
                init: empty,
                goto: empty,
		next: empty,
                prev_slide: empty,
                next_slide: empty,
		overview: empty,
		start: empty,
		anime: empty
            };
        }
        
        rootId = rootId || "flides";
        
        // if given root is already initialized just return the API
        if (roots["flides-root-" + rootId]) {
            return roots["flides-root-" + rootId];
        }
        
        // data of all presentation steps
        var stepsData = {};
        
        // element of currently active step
        var activeStep = null;
        
        // current state (position, rotation and scale) of the presentation
        var currentState = null;
        
        // array of step elements
        var steps = null;
        
        // configuration options
        var config = null;
        
        // scale factor of the browser window
        var windowScale = null;        
        
        // root presentation elements
        var root = byId( rootId );
        var canvas = document.createElement("div");
        
        var initialized = false;
        
        // STEP EVENTS
        //
        // There are currently two step events triggered by flides.js
        // `flides:stepenter` is triggered when the step is shown on the 
        // screen (the transition from the previous one is finished) and
        // `flides:stepleave` is triggered when the step is left (the
        // transition to next step just starts).
        
        // reference to last entered step
        var lastEntered = null;
        
        // `onStepEnter` is called whenever the step element is entered
        // but the event is triggered only if the step is different than
        // last entered step.
        var onStepEnter = function (step) {
            if (lastEntered !== step) {
                triggerEvent(step, "flides:stepenter");
                lastEntered = step;
            }
        };
        
        // `onStepLeave` is called whenever the step element is left
        // but the event is triggered only if the step is the same as
        // last entered step.
        var onStepLeave = function (step) {
            if (lastEntered === step) {
                triggerEvent(step, "flides:stepleave");
                lastEntered = null;
            }
        };
        
        // `initStep` initializes given step element by reading data from its
        // data attributes and setting correct styles.
        var initStep = function ( el, idx ) {
            var data = el.dataset,
                step = {
                    translate: {
                        x: toNumber(data.x),
                        y: toNumber(data.y),
                        z: toNumber(data.z)
                    },
                    rotate: {
                        x: toNumber(data.rotateX),
                        y: toNumber(data.rotateY),
                        z: toNumber(data.rotateZ || data.rotate)
                    },
                    scale: toNumber(data.scale, 1),
		    fixed: toNumber(data.fixed, 0),
		    duration: toNumber(data.duration, 1000),
                    el: el
                };
            
            if ( !el.id ) {
                el.id = "step-" + (idx + 1);
            }
            
	    stepsData["flides-" + el.id] = step;

            css(el, {
                position: "absolute",
                transform: "translate(-50%,-50%)" +
                           translate(step.translate) +
                           rotate(step.rotate) +
                           scale(step.scale),
                transformStyle: "preserve-3d"
            });
        };
        
        // `init` API function that initializes (and runs) the presentation.
        var init = function () {
            if (initialized) { return; }
            
            // First we set up the viewport for mobile devices.
            // For some reason iPad goes nuts when it is not done properly.
            var meta = $("meta[name='viewport']") || document.createElement("meta");
            meta.content = "width=device-width, minimum-scale=1, maximum-scale=1, user-scalable=no";
            if (meta.parentNode !== document.head) {
                meta.name = 'viewport';
                document.head.appendChild(meta);
            }
            
            // initialize configuration object
            var rootData = root.dataset;
            config = {
                width: toNumber( rootData.width, defaults.width ),
                height: toNumber( rootData.height, defaults.height ),
                maxScale: toNumber( rootData.maxScale, defaults.maxScale ),
                minScale: toNumber( rootData.minScale, defaults.minScale ),                
                perspective: toNumber( rootData.perspective, defaults.perspective ),
                transitionDuration: toNumber( rootData.transitionDuration, defaults.transitionDuration )
            };
            
            windowScale = computeWindowScale( config );
            
            // wrap steps with "canvas" element
            arrayify( root.childNodes ).forEach(function ( el ) {
                canvas.appendChild( el );
            });
            root.appendChild(canvas);
            
            // set initial styles
            document.documentElement.style.height = "100%";
            
            css(body, {
                height: "100%",
                overflow: "hidden"
            });
            
            var rootStyles = {
                position: "absolute",
                transformOrigin: "top left",
                transition: "all 0s ease-in-out",
                transformStyle: "preserve-3d"
            };
            
            css(root, rootStyles);
            css(root, {
                top: "50%",
                left: "50%",
                transform: perspective( config.perspective/windowScale ) + scale( windowScale )
            });
            css(canvas, rootStyles);
            
            body.classList.remove("flides-disabled");
            body.classList.add("flides-enabled");
            
            // get and init steps
            steps = $$(".step", root);
            steps.forEach( initStep );
            
            // set a default initial state of the canvas
            currentState = {
                translate: { x: 0, y: 0, z: 0 },
                rotate:    { x: 0, y: 0, z: 0 },
                scale:     1
            };
            
            initialized = true;
            
            triggerEvent(root, "flides:init", { api: roots[ "flides-root-" + rootId ] });
        };
        
        // `getStep` is a helper function that returns a step element defined by parameter.
        // If a number is given, step with index given by the number is returned, if a string
        // is given step element with such id is returned, if DOM element is given it is returned
        // if it is a correct step element.
        var getStep = function ( step ) {
            if (typeof step === "number") {
                step = step < 0 ? steps[ steps.length + step] : steps[ step ];
            } else if (typeof step === "string") {
                step = byId(step);
            }
            return (step && step.id && stepsData["flides-" + step.id]) ? step : null;
        };
        
        // used to reset timeout for `flides:stepenter` event
        var stepEnterTimeout = null;
        
	var init_slide = function ( activeStep ) {

	    // a slide_step can be: slide_step_visible, or slide_step_hidden
            var tabslidestep = $$(".slide_step", activeStep);
            tabslidestep.forEach( function( el ){
			el.classList.remove("slide_step_visible");
			el.classList.add("slide_step_hidden");
		});

	    // a token can be: token_visible, token_invisible_future, token_invisible_past
            var tabtoken = $$(".token", activeStep);
            tabtoken.forEach( function( el ){
			el.classList.add("token_invisible_future");
			el.classList.remove("token_invisible_past");
			el.classList.remove("token_visible");
		});
        }

        // `goto` API function that moves to step given with `el` parameter (by index, id or element),
        // with a transition `duration` optionally given as second parameter.
        var goto = function ( el, duration ) {
            
            if ( !initialized || !(el = getStep(el)) ) {
                // presentation not initialized or given element is not a step
                return false;
            }
            
            // Sometimes it's possible to trigger focus on first link with some keyboard action.
            // Browser in such a case tries to scroll the page to make this element visible
            // (even that body overflow is set to hidden) and it breaks our careful positioning.
            //
            // So, as a lousy (and lazy) workaround we will make the page scroll back to the top
            // whenever slide is selected
            //
            // If you are reading this and know any better way to handle it, I'll be glad to hear about it!
            window.scrollTo(0, 0);
            
            var step = stepsData["flides-" + el.id];

            if ( activeStep ) {
                activeStep.classList.remove("active");
                body.classList.remove("flides-on-" + activeStep.id);
            }
            el.classList.add("active");
            
            body.classList.add("flides-on-" + el.id);
            
            // compute target state of the canvas based on given step
            var target = {
                rotate: {
                    x: -step.rotate.x,
                    y: -step.rotate.y,
                    z: -step.rotate.z
                },
                translate: {
                    x: -step.translate.x,
                    y: -step.translate.y,
                    z: -step.translate.z
                },
                scale: 1 / step.scale
            };
            
            // Check if the transition is zooming in or not.
            //
            // This information is used to alter the transition style:
            // when we are zooming in - we start with move and rotate transition
            // and the scaling is delayed, but when we are zooming out we start
            // with scaling down and move and rotation are delayed.
            var zoomin = target.scale >= currentState.scale;
 
            duration = toNumber(duration, step.duration);
            var delay = (duration / 2);
            
            // if the same step is re-selected, force computing window scaling,
            // because it is likely to be caused by window resize
            if (el === activeStep) {
                windowScale = computeWindowScale(config);
            }
            
            var targetScale = target.scale * windowScale;
            
            // trigger leave of currently active element (if it's not the same step again)
            if (activeStep && activeStep !== el) {
                onStepLeave(activeStep);
            }
            
            // Now we alter transforms of `root` and `canvas` to trigger transitions.
            //
            // And here is why there are two elements: `root` and `canvas` - they are
            // being animated separately:
            // `root` is used for scaling and `canvas` for translate and rotations.
            // Transitions on them are triggered with different delays (to make
            // visually nice and 'natural' looking transitions), so we need to know
            // that both of them are finished.
            css(root, {
                // to keep the perspective look similar for different scales
                // we need to 'scale' the perspective, too
                transform: perspective( config.perspective / targetScale ) + scale( targetScale ),
                transitionDuration: duration + "ms",
                transitionDelay: (zoomin ? delay : 0) + "ms"
            });
            
            css(canvas, {
                transform: rotate(target.rotate, true) + translate(target.translate),
                transitionDuration: duration + "ms",
                transitionDelay: (zoomin ? 0 : delay) + "ms"
            });
            
            // Here is a tricky part...
            //
            // If there is no change in scale or no change in rotation and translation, it means there was actually
            // no delay - because there was no transition on `root` or `canvas` elements.
            // We want to trigger `flides:stepenter` event in the correct moment, so here we compare the current
            // and target values to check if delay should be taken into account.
            //
            // I know that this `if` statement looks scary, but it's pretty simple when you know what is going on
            // - it's simply comparing all the values.
            if ( currentState.scale === target.scale ||
                (currentState.rotate.x === target.rotate.x && currentState.rotate.y === target.rotate.y &&
                 currentState.rotate.z === target.rotate.z && currentState.translate.x === target.translate.x &&
                 currentState.translate.y === target.translate.y && currentState.translate.z === target.translate.z) ) {
                delay = 0;
            }
            
            // store current state
            currentState = target;
            activeStep = el;
            
            // And here is where we trigger `flides:stepenter` event.
            // We simply set up a timeout to fire it taking transition duration (and possible delay) into account.
            //
            // I really wanted to make it in more elegant way. The `transitionend` event seemed to be the best way
            // to do it, but the fact that I'm using transitions on two separate elements and that the `transitionend`
            // event is only triggered when there was a transition (change in the values) caused some bugs and 
            // made the code really complicated, cause I had to handle all the conditions separately. And it still
            // needed a `setTimeout` fallback for the situations when there is no transition at all.
            // So I decided that I'd rather make the code simpler than use shiny new `transitionend`.
            //
            // If you want learn something interesting and see how it was done with `transitionend` go back to
            // version 0.5.2 of flides.js: http://github.com/bartaz/flides.js/blob/0.5.2/js/flides.js
            window.clearTimeout(stepEnterTimeout);
            stepEnterTimeout = window.setTimeout(function() {
                onStepEnter(activeStep);
            }, duration + delay);
            
	    init_slide(activeStep) ;

	    var i = steps.indexOf(activeStep);

            steps.forEach( function( el ){
			if(steps.indexOf(el) <= i){
				el.classList.add("seen");
			}
			if(steps.indexOf(el) > i){
				el.classList.remove("seen");
			}
	    });

            return el;
        };
        
        // `prev_slide` API function goes to previous step (in document order)
        var prev_slide = function () {
	    var something_hidden = $(".slide_step.slide_step_visible", activeStep);
		if(something_hidden != null){
	            	var tabslidestep = $$(".slide_step", activeStep);
	            	tabslidestep.forEach( function( el ){
				el.classList.add("slide_step_hidden");
				el.classList.remove("slide_step_visible");
			});
		}
		else if(stepsData["flides-" + activeStep.id].fixed){
			return true;
		}
		else{
		        var prev = steps.indexOf( activeStep ) - 1;
			while(stepsData["flides-" + steps[prev].id].fixed){
				prev--;
			}
            		prev = prev >= 0 ? steps[ prev ] : steps[ 0 ];
            
            		return goto(prev);
		};
        };
        
        // `next_slide` API function uncovers the next slide_step if any is to be uncovered, or go to the next slide
        var next_slide = function () {
	    var next = $(".slide_step.slide_step_hidden", activeStep);
		if(next != null){
	    		next.classList.remove("slide_step_hidden");
	    		next.classList.add("slide_step_visible");
		}
		else if(stepsData["flides-" + activeStep.id].fixed){
			return true;
		}
		else{
			next = steps.indexOf( activeStep ) + 1;
			while(stepsData["flides-" + steps[next].id].fixed){
				next++;
			}
            		next = next < steps.length ? steps[ next ] : steps[ steps.length - 1 ];

            		return goto(next);
		};
        };
        
        // `next` API function uncovers the whole slide
        var next = function () {
            var tabslidestep = $$(".slide_step", activeStep);
            tabslidestep.forEach( function( el ){
			el.classList.remove("slide_step_hidden");
			el.classList.add("slide_step_visible");
		});
        };

        // `anime` API function uncovers the next token
	// a token can be: token_visible, token_invisible_future, token_invisible_past
        var anime = function () {
	    var next = $(".token.token_invisible_future", activeStep);
	    var previous = $(".token.token_visible", activeStep);
		if(previous != null){
	    		previous.classList.remove("token_visible");
	    		previous.classList.add("token_invisible_past");
		}
		if(next != null){
	    		next.classList.remove("token_invisible_future");
	    		next.classList.add("token_visible");
		}
		else{
			var tabtoken = $$(".token", activeStep);
			tabtoken.forEach( function( el ){
				el.classList.remove("token_invisible_past");
				el.classList.add("token_invisible_future");
			});
			next = $(".token", activeStep);
	    		next.classList.remove("token_invisible_future");
	    		next.classList.add("token_visible");
		}
        };

        // `overview` API function goes to the last step, overview
        var overview = function () {
            var overview = steps[ steps.length - 1 ];
          
            return goto(overview);
        };

        // `start` API function goes to the first step
        var start = function () {
            var start = steps[ 0 ];
          
            return goto(start);
        };

       
        // Adding hash change support.
        root.addEventListener("flides:init", function(){
            
            // last hash detected
            var lastHash = "";
            
            // `#/step-id` is used instead of `#step-id` to prevent default browser
            // scrolling to element in hash.
            //
            // And it has to be set after animation finishes, because in Chrome it
            // makes transtion laggy.
            // BUG: http://code.google.com/p/chromium/issues/detail?id=62820
            root.addEventListener("flides:stepenter", function (event) {
                window.location.hash = lastHash = "#/" + event.target.id;
            }, false);
            
            window.addEventListener("hashchange", function () {
                // When the step is entered hash in the location is updated
                // (just few lines above from here), so the hash change is 
                // triggered and we would call `goto` again on the same element.
                //
                // To avoid this we store last entered hash and compare.
                if (window.location.hash !== lastHash) {
                    goto( getElementFromHash() );
                }
            }, false);
            
            // START 
            // by selecting step defined in url or first step of the presentation
            goto(getElementFromHash() || steps[0], 0);
        }, false);
        
        body.classList.add("flides-disabled");
        
        // store and return API for given flides.js root element
        return (roots[ "flides-root-" + rootId ] = {
            init: init,
            goto: goto,
            next: next,
            next_slide: next_slide,
            prev_slide: prev_slide,
	    overview: overview,
	    start: start,
	    anime: anime
        });

    };
    
    // flag that can be used in JS to check if browser have passed the support test
    flides.supported = flidesSupported;
    
})(document, window);

// NAVIGATION EVENTS

// As you can see this part is separate from the flides.js core code.
// It's because these navigation actions only need what flides.js provides with
// its simple API.
//
// In future I think about moving it to make them optional, move to separate files
// and treat more like a 'plugins'.
(function ( document, window ) {
    'use strict';
    
    // throttling function calls, by Remy Sharp
    // http://remysharp.com/2010/07/21/throttling-function-calls/
    var throttle = function (fn, delay) {
        var timer = null;
        return function () {
            var context = this, args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(context, args);
            }, delay);
        };
    };
    
    // wait for flides.js to be initialized
    document.addEventListener("flides:init", function (event) {
        // Getting API from event data.
        // So you don't event need to know what is the id of the root element
        // or anything. `flides:init` event data gives you everything you 
        // need to control the presentation that was just initialized.
        var api = event.detail.api;
        
        // KEYBOARD NAVIGATION HANDLERS
        
        // Prevent default keydown action when one of supported key is pressed.
        document.addEventListener("keydown", function ( event ) {
            if ( ( event.keyCode == 8 ) || ( event.keyCode == 13 ) || ( event.keyCode >= 32 && event.keyCode <= 34 ) || (event.keyCode >= 37 && event.keyCode <= 40) ) {
                event.preventDefault();
            }
        }, false);
        
        // Trigger flides action (next or prev) on keyup.
        // Supported keys are:

	// [right] - either uncovers the next element in the current slide, or goes to the next
        // [space] - use the animations from the current slide

        // [up] [left] [pgup] - goes to the previous slide
	// [down] [pg down] - uncovers all elements of the current slide

        // [backspace] - start over,
        // [enter] - go to the final overview,
        document.addEventListener("keyup", function ( event ) {
            if ( ( event.keyCode == 8 ) || ( event.keyCode == 13 ) || ( event.keyCode >= 32 && event.keyCode <= 34 ) || (event.keyCode >= 37 && event.keyCode <= 40) 
		|| ( event.keyCode == 66 ) || ( event.keyCode == 16 )) {
                switch( event.keyCode ) {
                    case 13: // enter
			     api.next();
                             break;
                    case 32: // space
                    case 66: // this is for my remote control
			     api.anime();
			     break;
                    case 33: // pg up
                    case 37: // left
                    case 38: // up
                             api.prev_slide();
                             break;
                    case 34: // pg down
                    case 40: // down
                    case 39: // right
                             api.next_slide();
			     break;		    
                    case 8: // backspace
			     api.start();
			     break;
                    case 16: // shift, this is for MY remote control
			     api.overview();
			     break;
                }
                
                event.preventDefault();
            }
        }, false);
        
        // delegated handler for clicking on the links to presentation steps
        document.addEventListener("click", function ( event ) {
            // event delegation with "bubbling"
            // check if event target (or any of its parents is a link)
            var target = event.target;
            var duration = 1000;

            while ( (target.tagName !== "A") &&
                    (target !== document.documentElement) ) {
                target = target.parentNode;
            }
            
            if ( target.tagName === "A" ) {
                var href = target.getAttribute("href");
                
                // if it's a link to presentation step, target this step
                if ( href && href[0] === '#' ) {
                    target = document.getElementById( href.slice(1) );
		    duration = 0;
                }
            }
            
            if ( api.goto(target,duration) ) {
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        }, false);
        
        // delegated handler for clicking on step elements
        document.addEventListener("click", function ( event ) {
            var target = event.target;
            // find closest step element that is not active
            while ( !(target.classList.contains("step") && !target.classList.contains("active") && !target.classList.contains("unclickable")) && (target !== document.documentElement) ) {
                target = target.parentNode;
            }
            
            if ( api.goto(target) ) {
                event.preventDefault();
            }
        }, false);
        
        // touch handler to detect taps on the left and right side of the screen
        // based on awesome work of @hakimel: https://github.com/hakimel/reveal.js
        document.addEventListener("touchstart", function ( event ) {
            if (event.touches.length === 1) {
                var x = event.touches[0].clientX,
                    width = window.innerWidth * 0.3,
                    result = null;
                    
                if ( x < width ) {
                    result = api.prev_slide();
                } else if ( x > window.innerWidth - width ) {
                    result = api.next_slide();
                }
                
                if (result) {
                    event.preventDefault();
                }
            }
        }, false);
        
        // rescale presentation when window is resized
        window.addEventListener("resize", throttle(function () {
            // force going to active step again, to trigger rescaling
            api.goto( document.querySelector(".step.active"), 500 );
        }, 250), false);
        
    }, false);
        
})(document, window);

