/**
* Modul zur Bildverarbeitung der Kinectbilder.
*/

var fs = require("fs");
var PImage = require('pureimage');
var kinect = require('./build/Release/kinect.node');
var Darknet = require('darknet').Darknet;
var express = require('express');
var app = express();
var http = require('http').Server(app);
var ioclient = require('socket.io-client');
var io = require('socket.io')(http);
var darknet = new Darknet({
    weights: './darknet/yolov3-tiny-obj.backup',
    config: './darknet/yolov3-tiny-obj.cfg',
    names: [ 'hand' ]
});

const MAGIC_NUMBER_X = 23.5;
const MAGIC_NUMBER_Z = 23.5;
const CENTER_OFFSET = 10;
const ACTIVATE_MOTORS = true;
const ACTIVATE_NEIGHBORS = false;
const ACTIVATE_TRAINING = false;

var displayCanvas = new PImage.make(640, 480);

var motorConnection = {
	0: ioclient.connect("http://192.168.8.100:3000"),
	1: ioclient.connect("http://192.168.8.101:3000"),
	2: ioclient.connect("http://192.168.8.102:3000"),
	3: ioclient.connect("http://192.168.8.103:3000")
};

const MAX_DIFF = 30;
const SCALE_FACTOR = 0.0021;
const MIN_DISTANCE = -10;
const TIMER_PUFFER = 10;
const MAX_HANDS_IN_TOUCHPOINT = 20;

const MOTOR_MAP = {	
	'0x0': [motorConnection[3], 12],
	'1x0': [motorConnection[3], 13],
	'2x0': [motorConnection[3], 14],
	'3x0': [motorConnection[3], 15],
	'4x0': [motorConnection[0], 0],
	'5x0': [motorConnection[0], 4],
	'6x0': [motorConnection[0], 8],
	'7x0': [motorConnection[0], 12],
	'0x1': [motorConnection[3], 8],
	'1x1': [motorConnection[3], 9],
	'2x1': [motorConnection[3], 10],
	'3x1': [motorConnection[3], 11],
	'4x1': [motorConnection[0], 1],
	'5x1': [motorConnection[0], 5],
	'6x1': [motorConnection[0], 9],
	'7x1': [motorConnection[0], 13],
	'0x2': [motorConnection[3], 4],
	'1x2': [motorConnection[3], 5],
	'2x2': [motorConnection[3], 6],
	'3x2': [motorConnection[3], 7],
	'4x2': [motorConnection[0], 2],
	'5x2': [motorConnection[0], 6],
	'6x2': [motorConnection[0], 10],
	'7x2': [motorConnection[0], 14],
	'0x3': [motorConnection[3], 0],
	'1x3': [motorConnection[3], 1],
	'2x3': [motorConnection[3], 2],
	'3x3': [motorConnection[3], 3],
	'4x3': [motorConnection[0], 3],
	'5x3': [motorConnection[0], 7],
	'6x3': [motorConnection[0], 11],
	'7x3': [motorConnection[0], 15],

	'0x4': [motorConnection[2], 12],
	'1x4': [motorConnection[2], 13],
	'2x4': [motorConnection[2], 14],
	'3x4': [motorConnection[2], 15],
	'4x4': [motorConnection[1], 15],
	'5x4': [motorConnection[1], 11],
	'6x4': [motorConnection[1], 7],
	'7x4': [motorConnection[1], 3],
	'0x5': [motorConnection[2], 8],
	'1x5': [motorConnection[2], 9],
	'2x5': [motorConnection[2], 10],
	'3x5': [motorConnection[2], 11],
	'4x5': [motorConnection[1], 14],
	'5x5': [motorConnection[1], 10],
	'6x5': [motorConnection[1], 6],
	'7x5': [motorConnection[1], 2],
	'0x6': [motorConnection[2], 4],
	'1x6': [motorConnection[2], 5],
	'2x6': [motorConnection[2], 6],
	'3x6': [motorConnection[2], 7],
	'4x6': [motorConnection[1], 13],
	'5x6': [motorConnection[1], 9],
	'6x6': [motorConnection[1], 5],
	'7x6': [motorConnection[1], 1],
	'0x7': [motorConnection[2], 0],
	'1x7': [motorConnection[2], 1],
	'2x7': [motorConnection[2], 2],
	'3x7': [motorConnection[2], 3],
	'4x7': [motorConnection[1], 12],
	'5x7': [motorConnection[1], 8],
	'6x7': [motorConnection[1], 4],
	'7x7': [motorConnection[1], 0],
};

Array.prototype.order = function(f) {
	return this.concat().sort(f);
};

Array.prototype.groupBy = function(prop) {
	return this.reduce(function(groups, item) {
	  const val = item[prop]
	  groups[val] = groups[val] || []
	  groups[val].push(item)
	  return groups
	}, {})
};

/**
* Klasse zur Darstellung eines Vektors.
* Beinhaltet Methoden zum subtrahieren von zwei Vektoren, zur Berechnung der Länge eines Vektors
* und zur Berechnung der Distanz zwischen zwei Punkten.
*/
class Vec3 {
	constructor(x, y, z) {
		this.x = x;
		this.y = y;
		this.z = z;
	}

	sub(v) {
		return new Vec3(
			this.x - v.x,
			this.y - v.y,
			this.z - v.z
		);
	}

	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}

	dist(v) {
		return this.sub(v).length();
	}
}

/**
* Liste, die Listen der gespeicherten Positionen
* aller gefundenen Hände in dem Bild beinhaltet.
*/
class TouchPoints {
	constructor() {
		this.touchPoints = [];
	}

	/**
	* Überprüft für alle gespeicherten Hände, ob sie noch im Bild gefunden werden.
	*/
	frame() {
		this.touchPoints.forEach(v => v.frame());
	}

	/**
	* Fügt eine der Liste eine neue Hand hinzu, wenn diese vorher noch
	* nie erkannt wurde. 
	* Falls die Hand bereits erkannt wurde, wird die neue Position
	* der entsprechenden Liste hinzugefügt.
	*/
	addHand(hand) {
		for (var i = 0; i < this.touchPoints.length; i++) {
			if(this.touchPoints[i].addHand(hand))
				return;
		}
		this.touchPoints.push(new TouchPoint(hand));
		console.log('New Hand found');
	}

	/**
	* Löscht alle Hände aus der Liste, die seit mehr als TIMER_PUFFER Frames 
	* nicht mehr im Bild erkannt wurden.
	*/
	removeExpiredHands() {
		this.touchPoints = this.touchPoints.filter(v => !v.expired());
	}

	/**
	* Gibt für jedes Modul ein Array der zu bewegenden Motoren zurück.
	*/
	motors() {
		var ret = [];
		var retArr = [];

		//Arrays vorinitialisieren
		for (var i = 0; i < 4; i++) {
			ret[i] = [];
			retArr[i] = [];
		}

		//Sortiert die Motoren nach ihrer jeweiligen Verbindung
		for (var i = 0; i < this.touchPoints.length; i++) {
			var p = this.touchPoints[i].getHighestHand();
            let m = [p.motor()].concat(p.neighbors());
            if (p.motor()) {
                for (let j = 0; j < m.length; j++) {
                    let q = m[j];
                    if(q !== null) {
                        if (q.connection == motorConnection[0]) {
                            ret[0].push({
                                motor: q.motor,
                                tar: q.tar
                            });
                        } else if (q.connection == motorConnection[1]) {
                            ret[1].push({
                                motor: q.motor,
                                tar: q.tar
                            });
                        } else if (q.connection == motorConnection[2]) {
                            ret[2].push({
                                motor: q.motor,
                                tar: q.tar
                            });
                        } else if (q.connection == motorConnection[3]) {
                            ret[3].push({
                                motor: q.motor,
                                tar: q.tar
                            });
                        }
                    }
                }
			}
		}
		
		for (var i = 0; i < ret.length; i++) {
			ret[i] = ret[i].groupBy('motor');

			//Pro Motor nach der Hand mit der höchsten Position suchen
			for (var key in ret[i]) {
				if (ret[i].hasOwnProperty(key)) {
					ret[i][key] = ret[i][key].reduce(function(prev, current) {
						return (prev.tar > current.tar) ? prev : current;
					});

					retArr[i].push(ret[i][key]);
				}
			}
		}

        return retArr;
	}
}

/**
* Liste mit allen Positionen einer Hand.
* Beinhaltet zusätzlich die Info, seit wie vielen Frames 
* die Hand nicht mehr erkannt wurde.
* Pro Hand werden maximal MAX_HANDS_IN_TOUCHPOINT Positionen gespeichert.
*/
class TouchPoint {
	constructor(hand) {
		this.hands = [hand];
		this.goneForFrames = TIMER_PUFFER;
		this.foundInCurrentFrame = false;
	}

	/**
	* Setzt das Flag, dass die Hand in diesem Frame nicht gefunden wurde
	* und zählt den Counter bis zum Löschen der Hand runter.
	*/
	frame() {
		this.foundInCurrentFrame = false;
		this.goneForFrames--;
	}

	/**
	* @return true, wenn die Hand seit der festgesetzten Framezahl nicht mehr erkannt wurde.
	*/
	expired() {
		return this.goneForFrames <= 0;
	}

	/**
	* Fügt der Liste eine neue Hand-Position hinzu, wenn es sich um die 
	* gleiche Hand handelt und die Hand im aktuellen Frame nocht nicht 
	* gefunden wurde. 
	* Außerdem wird der Zeitpuffer bis zum Löschen der Hand zurückgesetzt.
	*/
	addHand(hand) {
		if(!this.foundInCurrentFrame && this.hands[0].isSame(hand)) {
			this.hands.unshift(hand);
			this.goneForFrames = TIMER_PUFFER;
			this.foundInCurrentFrame = true;
			this.hands = this.hands.splice(0, MAX_HANDS_IN_TOUCHPOINT);
			return true;
		}
		return false;
	}

	/**
	* Gibt die höchste gespeicherte Position der Hand zurück.
	*/
	getHighestHand() {
		return this.hands.order((a, b) => a.coords().y - b.coords().y)[0];
	}
}

/**
* Klasse zur internen Darstellung einer gefundenen Hand. 
*/
class Hand {
	/**
	*@param box Bounding Box der gefundenden Hand
	*@param depth Tiefenwert Im Mittelpunkt der Box 
	*/
	constructor(box, depth) {
		this.box = box;
		this.depth = depth;
	}

	/**
	* Rechnet die Koordinaten der Hand im Kinectbild anhand des Tiefenwerts aus.
	*/
	coords() {
		// Umrechnung Kinect in CM
		var z = 100 / (-0.00307 * this.depth + 3.33);
		var x = (Math.floor(this.box.x) - 640 / 2) * (z + MIN_DISTANCE) * SCALE_FACTOR;
		var y = (Math.floor(this.box.y) - 480 / 2) * (z + MIN_DISTANCE) * SCALE_FACTOR;
		
		// X-Koordinate in den Mittelpunkt verschieben
		// Nullpunkt an Bildrand verschieben + Mittelpunkt->Eckstern - Modulrand
		x += CENTER_OFFSET + 100 - 10;
		//Abstand Kinect->Gerüst + Modulrand
		z -= 120 + 20;

		return new Vec3(x, y, z);
	}

	/**
	* Rechnet die projizierten x-z-Koordinaten der Kinect in reale Koordinaten um.
	*/
    worldCoords() {
		// 23.5 ist eine magische Zahl, die eigentlich 20 sein müsste
        var x = (Math.floor((this.coords().x) / MAGIC_NUMBER_X));
		var z = (Math.floor((this.coords().z) / MAGIC_NUMBER_Z));
        return [x, z];
    }

	/**
	* Rechnet die Höhe der Hand aus.
	*/
	motorHeight() {
		//152 ist der Abstand von den Sternenmodulen zur Kinect
		return 152 + this.coords().y;
	}

	/**
	* Gibt an, ob die übergebene Hand die gleiche ist wie diese Hand.
	* @return true, wenn die Distanz zwischen beiden Händen kleiner ist, als MAX_DIFF
	*/
	isSame(hand) {
		return this.coords().dist(hand.coords()) <= MAX_DIFF;
    }

	/**
	* Weist den Koordinaten der Hand den entsprechenden Motor zu.
	* @return gemappter Motor oder null, wenn kein Motor den Koordinaten entpricht
	*/
    mapMotor(coords, offset) {
        if(typeof offset == "undefined") var offset = 0;
        let section = coords[0] + 'x' + coords[1];
        if(typeof MOTOR_MAP[section] != "undefined") {
            return {
				connection: MOTOR_MAP[section][0],
                motor: MOTOR_MAP[section][1],
                tar: this.motorHeight() + offset
            };
        }
        return null;
    }

	/**
	* @return der Hand entsprechender Motor oder null
	*/
    motor() {
        return this.mapMotor(this.worldCoords());
    }

	/**
	* Berechnet zu dem aktuellen Motor die 8 Nachbarmotoren.
	* @return Array der Nachbarmotoren
	*/
    neighbors() {
        if(!ACTIVATE_NEIGHBORS) return [];
        let ret = [];
        let coords = this.worldCoords();
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                if(!(x == 0 && y == 0)) {
                    let curcoords = [coords[0] + x, coords[1] + y];
                    ret.push(this.mapMotor(curcoords, -20));
                }
            }
        }
        return ret;
    }
}

// motorConnection.on('connect', function() {
// 	console.log('Connected');
// });

kinect.init(function(data) {
    console.log(data);
});

var dc = 0;
var touchPoints = new TouchPoints();
var f = function() {
    kinect.getFrame(function(msg, arr) {
		//Zwischenspeichern des aktuellen Frames
		fs.writeFileSync("./tmp.png", msg);
		var ctx = displayCanvas.getContext('2d');

		//Anzeige des aktuellen Frames
		PImage.decodePNGFromStream(fs.createReadStream("./tmp.png")).then((img) => {
			ctx.drawImage(img,
				0, 0, img.width, img.height
			);
		});
			//Handerkennung mittels Darknet
			darknet.detectAsync("./tmp.png")
                .then(function(data) {
					if(ACTIVATE_TRAINING) writeXML(msg, data);
					
					touchPoints.frame();
					for (var i = 0; i < data.length; i++) {
                        if (data[i].name == "hand") {
							touchPoints.addHand(new Hand(
								data[i].box,
								//Ausrechnen des Tiefenwerts im Mittelpunkt der Hand
								arr[640 * Math.floor(data[i].box.y) + Math.floor(data[i].box.x)]
							));
							
							//Zeichnet Rechteck um gefundene Hand
							ctx.beginPath();
							ctx.strokeStyle = 'rgba(0,0,0, 1.0)';
							ctx.strokeRect(
								data[i].box.x - data[i].box.w / 2,
								data[i].box.y - data[i].box.h / 2,
								data[i].box.w,
								data[i].box.h
							);
							ctx.stroke();
							
							//Zeichnet Mittelpunkt der Hand
							ctx.beginPath();
							ctx.strokeStyle = 'rgba(0,200,0, 1.0)';
							ctx.strokeRect(data[i].box.x - 3/2, data[i].box.y - 3/2, 3, 3);
							ctx.stroke();
						}
					}

                    touchPoints.removeExpiredHands();

					//debug
					var ret = touchPoints.motors();

					//senden der zu bewegenden Motorenliste an den entsprechenden Raspberry
                    if(ACTIVATE_MOTORS) {
                        for (var i = 0; i < 4; i++) {
                            motorConnection[i].emit('update_targets_cm', ret[i]);
                        }
                    }
                    
					//Zeichnet Pfade der Hände
					for (var i = 0; i < touchPoints.touchPoints.length; i++) {
						var touchPoint = touchPoints.touchPoints[i];
						ctx.beginPath();
						ctx.strokeStyle = 'rgba(255,0,0,1.0)'
						ctx.strokeRect(touchPoint.getHighestHand().box.x - 3/2, touchPoint.getHighestHand().box.y - 3/2, 3, 3);
						ctx.stroke();

						ctx.strokeStyle = [
							'rgba(200,0,0, 1.0)',
							'rgba(0,200,0, 1.0)',
							'rgba(0,0,200, 1.0)',
						][i % 3];
						ctx.beginPath();
						ctx.moveTo(touchPoint.hands[0].box.x,touchPoint.hands[0].box.y);
						for (var j = 1; j < touchPoint.hands.length; j++) {
							ctx.lineTo(touchPoint.hands[j].box.x,touchPoint.hands[j].box.y);
						}
						ctx.stroke();
					}

					//Zeichnet den Mittelpunkt des Bildes
					ctx.beginPath();
					ctx.fillStyle = 'rgba(200,0,0, 1.0)';
					ctx.fillRect(640/2-2.5, 480/2-2.5, 5,5);
                    ctx.stroke();
                  
					PImage.encodePNGToDataUri(displayCanvas).then((data) => {
						io.emit('img', data);
					});

                    setTimeout(function() { f(); }, 100);
                });
    });
};

io.on('connection', function(socket) {
    // nothing to do here
});

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

http.listen(3000, function() {
    console.log('Example app listening on port 3000!');
    f();
});

var training_idx = 0;
var training_count = 0;

/**
* Schreibt eine Label-XML zum Trainieren von Darknet YOLO.
*/
function writeXML(img, data) {
	if(training_count++ % 10 == 0) {
		var objects = data.map(function(obj) {
				var xmin = Math.round(obj.box.x - obj.box.w / 2);
				var ymin = Math.round(obj.box.y - obj.box.h / 2);
				var xmax = Math.round(obj.box.x + obj.box.w / 2);
				var ymax = Math.round(obj.box.y + obj.box.h / 2);
				return `<object>
							<name>${obj.name}</name>
							<pose>Unspecified</pose>
							<truncated>0</truncated>
							<difficult>0</difficult>
							<bndbox>
								<xmin>${xmin}</xmin>
								<ymin>${ymin}</ymin>
								<xmax>${xmax}</xmax>
								<ymax>${ymax}</ymax>
							</bndbox>
						</object>`;
		}).join("\n");
		var xml = `<annotation>
						<folder>training</folder>
						<filename>tmp_${training_idx}.png</filename>
						<path>/home/sternenhimmel/training/tmp_${training_idx}.png</path>
						<source>
							<database>Unknown</database>
						</source>
						<size>
							<width>640</width>
							<height>480</height>
							<depth>1</depth>
						</size>
						<segmented>0</segmented>
						${objects}
					</annotation>`;
		fs.writeFileSync("./training/tmp_" + training_idx + ".png", img);
		fs.writeFileSync("./training/tmp_" + training_idx + ".xml", xml);
		training_idx++;
	}
}
