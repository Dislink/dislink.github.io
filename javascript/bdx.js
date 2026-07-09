(function (){
	var bdx=this;
	this.builtInCommands = {
		'CreateConstantString': 1,
		'PlaceBlockWithBlockStates': 5,
		'AddInt16ZValue0': 6,
		'PlaceBlock': 7,
		'AddZValue0': 8,
		'NoOperation': 9,
		'AddInt32ZValue0': 12,
		'PlaceBlockWithBlockStatesDeprecated': 13,
		'AddXValue': 14,
		'SubtractXValue': 15,
		'AddYValue': 16,
		'SubtractYValue': 17,
		'AddZValue': 18,
		'SubtractZValue': 19,
		'AddInt16XValue': 20,
		'AddInt32XValue': 21,
		'AddInt16YValue': 22,
		'AddInt32YValue': 23,
		'AddInt16ZValue': 24,
		'AddInt32ZValue': 25,
		'SetCommandBlockData': 26,
		'PlaceBlockWithCommandBlockData': 27,
		'AddInt8XValue': 28,
		'AddInt8YValue': 29,
		'AddInt8ZValue': 30,
		'UseRuntimeIDPool': 31,
		'PlaceRuntimeBlock': 32,
		'PlaceRuntimeBlockWithUint32RuntimeID': 33,
		'PlaceRuntimeBlockWithCommandBlockData': 34,
		'PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID': 35,
		'PlaceCommandBlockWithCommandBlockData': 36,
		'PlaceRuntimeBlockWithChestData': 37,
		'PlaceRuntimeBlockWithChestDataAndUint32RuntimeID': 38,
		'AssignDebugData': 39,
		'PlaceBlockWithChestData': 40,
		'PlaceBlockWithNBTData': 41,
		'Terminate': 88,
		'End': 69,
		'isSigned': 90,
		ModifyX: [14,15,20,21,28],
		ModifyY: [16,17,22,23,29],
		ModifyZ: [18,19,24,25,30,8,12]
	}
	this.commandNames = {
		1: 'CreateConstantString',
		5: 'PlaceBlockWithBlockStates',
		6: 'AddInt16ZValue0',
		7: 'PlaceBlock',
		8: 'AddZValue0',
		9: 'NoOperation',
		12: 'AddInt32ZValue0',
		13: 'PlaceBlockWithBlockStatesDeprecated',
		14: 'AddXValue',
		15: 'SubtractXValue',
		16: 'AddYValue',
		17: 'SubtractYValue',
		18: 'AddZValue',
		19: 'SubtractZValue',
		20: 'AddInt16XValue',
		21: 'AddInt32XValue',
		22: 'AddInt16YValue',
		23: 'AddInt32YValue',
		24: 'AddInt16ZValue',
		25: 'AddInt32ZValue',
		26: 'SetCommandBlockData',
		27: 'PlaceBlockWithCommandBlockData',
		28: 'AddInt8XValue',
		29: 'AddInt8YValue',
		30: 'AddInt8ZValue',
		31: 'UseRuntimeIDPool',
		32: 'PlaceRuntimeBlock',
		33: 'PlaceRuntimeBlockWithUint32RuntimeID',
		34: 'PlaceRuntimeBlockWithCommandBlockData',
		35: 'PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID',
		36: 'PlaceCommandBlockWithCommandBlockData',
		37: 'PlaceRuntimeBlockWithChestData',
		38: 'PlaceRuntimeBlockWithChestDataAndUint32RuntimeID',
		39: 'AssignDebugData',
		40: 'PlaceBlockWithChestData',
		41: 'PlaceBlockWithNBTData',
		88: 'Terminate',
		69: 'End',
		90: 'isSigned'
	}
	this.commandParams={
		"CreateConstantString": {'constantString': 'String'},
		"PlaceBlockWithBlockStates": {'blockConstantStringID': 'Uint16', 'blockStatesConstantStringID': 'Uint16'},
		"AddInt16ZValue0": {'value': 'Uint16'},
		"PlaceBlock": {'blockConstantStringID': 'Uint16', 'blockData': 'Uint16'},
		"AddZValue0": {},
		"NoOperation": {},
		"AddInt32ZValue0": {'value': 'Uint32'},
		"PlaceBlockWithBlockStatesDeprecated": {'blockConstantStringID': 'Uint16', 'blockStatesString': 'String'},
		"AddXValue": {},
		"SubtractXValue": {},
		"AddYValue": {},
		"SubtractYValue": {},
		"AddZValue": {},
		"SubtractZValue": {},
		"AddInt16XValue": {'value': 'Int16'},
		"AddInt32XValue": {'value': 'Int32'},
		"AddInt16YValue": {'value': 'Int16'},
		"AddInt32YValue": {'value': 'Int32'},
		"AddInt16ZValue": {'value': 'Int16'},
		"AddInt32ZValue": {'value': 'Int32'},
		"SetCommandBlockData": {'mode': 'Uint32', 'command': 'String','customName': 'String','lastOutput': 'String','tickdelay': 'Int32','executeOnFirstTick': 'Bool','trackOutput': 'Bool','conditional': 'Bool','needsRedstone': 'Bool'},
		"PlaceBlockWithCommandBlockData": {'blockConstantStringID': 'Uint16','blockData': 'Uint16', 'mode': 'Uint32', 'command': 'String','customName': 'String','lastOutput': 'String','tickdelay': 'Int32','executeOnFirstTick': 'Bool','trackOutput': 'Bool','conditional': 'Bool','needsRedstone': 'Bool'},
		"AddInt8XValue": {'value': 'Int8'},
		"AddInt8YValue": {'value': 'Int8'},
		"AddInt8ZValue": {'value': 'Int8'},
		"UseRuntimeIDPool": {'poolId': 'Uint8'},
		"PlaceRuntimeBlock": {'runtimeId': 'Uint16'},
		"PlaceRuntimeBlockWithUint32RuntimeID": {'runtimeId': 'Uint32'},
		"PlaceRuntimeBlockWithCommandBlockData": {'runtimeId': 'Uint16', 'mode': 'Uint32', 'command': 'String','customName': 'String','lastOutput': 'String','tickdelay': 'Int32','executeOnFirstTick': 'Bool','trackOutput': 'Bool','conditional': 'Bool','needsRedstone': 'Bool'},
		"PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID": {'runtimeId': 'Uint32', 'mode': 'Uint32', 'command': 'String','customName': 'String','lastOutput': 'String','tickdelay': 'Int32','executeOnFirstTick': 'Bool','trackOutput': 'Bool','conditional': 'Bool','needsRedstone': 'Bool'},
		"PlaceCommandBlockWithCommandBlockData": {'data': 'Uint16', 'mode': 'Uint32', 'command': 'String','customName': 'String','lastOutput': 'String','tickdelay': 'Int32','executeOnFirstTick': 'Bool','trackOutput': 'Bool','conditional': 'Bool','needsRedstone': 'Bool'},
		"PlaceRuntimeBlockWithChestData": {'runtimeId': 'Uint16', 'slotCount': 'Uint8', 'data': 'ChestData'},
		"PlaceRuntimeBlockWithChestDataAndUint32RuntimeID": {'runtimeId': 'Uint32', 'slotCount': 'Uint8', 'data': 'ChestData'},
		"AssignDebugData": {'length': 'Uint32', 'buffer': 'Buffered'},
		"PlaceBlockWithChestData": {'blockConstantStringID': 'Uint16','blockData': 'Uint16', 'data': 'ChestData'},
		"PlaceBlockWithNBTData": {'blockConstantStringID': 'Uint16', 'blockStatesConstantStringIDDeprecated': 'Uint16', 'blockStatesConstantStringID': 'Uint16', 'buffer': 'NBTUncompressed'},
		"Terminate": {},
		"End": {},
		"isSigned": {'signatureSize': 'Uint8'/* pseudo*/}
	}
	DataView.prototype.getString = function (offset=0){
		let string,char;
		string=[];
		while((char=this.getUint8(offset))){
			string.push(char);
			offset++;
		}
		return new TextDecoder().decode(new Uint8Array(string).buffer);
	}
	DataView.prototype.setString = function (offset=0, value){
		let begin=offset;
		for(let i of new TextEncoder().encode(value)){
			this.setUint8(offset++, i);
		}
		this.setUint8(offset++, 0);
		return offset-begin;
	}
	DataView.prototype.getBool = function (offset=0){
		return Boolean(this.getUint8(offset));
	}
	DataView.prototype.setBool = function (offset=0, value=false){
		return this.setUint8(offset, value);
	}
	DataView.prototype.getBuffered = function (offset=0, length=0){
		let dv,ab;
		dv=new DataView(ab=new ArrayBuffer(length));
		for(let i=0;i<length;i++){
			dv.setUint8(i,this.getUint8(offset+i))
		}
		return ab;
	}
	DataView.prototype.setBuffered = function (offset=0, buffer){
		let dv=new DataView(buffer);
		for(let i=0;i<buffer.byteLength;i++){
			this.setUint8(offset+i,dv.getUint8(i))
		}
		return;
	}
	DataView.prototype.getNBTUncompressed = function (offset=0, littleEndian=true){
		let reader=new nbt.Reader(this.buffer, littleEndian, offset);
		if (reader.byte() !== nbt.tagTypes.compound) {
			throw new Error('Top tag should be a compound');
		}
		console.log('offset',this.offset);
		let value={};
		value[reader.string()]={
			type:'compound',
			value: reader.compound(),
			littleEndian: littleEndian,
			size: reader.offset-offset
		}
		return value;
	}
	DataView.prototype.setNBTUncompressed = function (offset=0, nbtData, littleEndian=true){
		let d;
		if(!nbtData.byteLength){
			let writer=new nbt.Writer(littleEndian);
			writer.compound(nbtData);
			d=writer.getData();
		}else{
			d=nbtData;
		}
		this.setBuffered(offset, d);
		return d.byteLength+1;
	}
	DataView.prototype.getChestData = function (offset=0){
		let resultArray=[];
		let begin=offset;
		for(let i=0;i<this.getUint8(offset++);i++){
			let itemName=this.getString(offset);
			offset+=itemName.length+1;
			let count=this.getUint8(offset++);
			let data=this.getUint16(offset);
			offset+=2;
			let slotID=this.getUint8(offset++);
			resultArray.push({
				itemName: itemName,
				count: count,
				data: data,
				slotID: slotID
			});
		}
		return {
			totLength:offset-begin,
			ChestData:resultArray
		}
	}
	DataView.prototype.setChestData = function (offset=0, value){
		let begin=offset;
		this.setUint8(offset++, value.ChestData.length);
		for(let i of value.ChestData){
			this.setString(offset, i.itemName);
			offset+=i.itemName.length+1;
			this.setUint8(offset++, i.count);
			this.setUint16(offset, i.data);
			offset+=2;
			this.setUint8(offset++, i.slotID);
		}
		return offset-begin;
	}
	DataView.prototype.size = {
		'BigInt64': 8,
		'BigUint64': 8,
		'Float64': 8,
		'Float32': 4,
		'Int32': 4,
		'Int16': 2,
		'Int8': 1,
		'Uint32': 4,
		'Uint16': 2,
		'Uint8': 1,
		'String': 0,
		'Bool': 1,
		'NBTUncompressed': 0
	}
	ArrayBuffer.prototype.toJSON=function (){
		return {"type":"ArrayBuffer","value":Array.from(new Uint8Array(this))};
	}
	this.Reader = function(buffer) {
		if (!buffer) { throw new Error('Argument "buffer" is falsy'); }
		this.DataView = new DataView(buffer);
		this.offset = 0 ;
		function readCommand(params,debugMode=0){
			let object={};
			for(let i in params){
				object[i]=this.DataView['get'+params[i]](this.offset);
				this.offset+=this.DataView.size[params[i]];
				if(params[i]=='String') this.offset+=new TextEncoder().encode(object[i]).byteLength+1;
				if(params[i]=='NBTUncompressed'){
					this.offset+=object[i][''].size;
					/*//怪 有时候nbt读取之后再写入长度不一样
					//这里size重填一下罢
					let writer=new nbt.Writer(object[i][''].littleEndian);
					writer.compound(object[i]);
					object[i][''].size=writer.getData().byteLength-1;*/
				}
				if(params[i]=='ChestData') this.offset+=object[i].totLength;
				if(debugMode) console.log(i,params[i],object[i],this.offset);
			}
			return object;
		}

		this.readCommand=readCommand;
		
		this[bdx.builtInCommands.CreateConstantString]=readCommand.bind(this, bdx.commandParams["CreateConstantString"]);
		this[bdx.builtInCommands.PlaceBlockWithBlockStates]=readCommand.bind(this, bdx.commandParams["PlaceBlockWithBlockStates"]);
		this[bdx.builtInCommands.AddInt16ZValue0]=readCommand.bind(this, bdx.commandParams["AddInt16ZValue0"]);
		this[bdx.builtInCommands.PlaceBlock]=readCommand.bind(this, bdx.commandParams["PlaceBlock"]);
		this[bdx.builtInCommands.AddZValue0]=readCommand.bind(this, bdx.commandParams["AddZValue0"]);
		this[bdx.builtInCommands.NoOperation]=readCommand.bind(this, bdx.commandParams["NoOperation"]);
		this[bdx.builtInCommands.AddInt32ZValue0]=readCommand.bind(this, bdx.commandParams["AddInt32ZValue0"]);
		this[bdx.builtInCommands.PlaceBlockWithBlockStatesDeprecated]=readCommand.bind(this, bdx.commandParams["PlaceBlockWithBlockStatesDeprecated"]);
		this[bdx.builtInCommands.AddXValue]=readCommand.bind(this, bdx.commandParams["AddXValue"]);
		this[bdx.builtInCommands.SubtractXValue]=readCommand.bind(this, bdx.commandParams["SubtractXValue"]);
		this[bdx.builtInCommands.AddYValue]=readCommand.bind(this, bdx.commandParams["AddYValue"]);
		this[bdx.builtInCommands.SubtractYValue]=readCommand.bind(this, bdx.commandParams["SubtractYValue"]);
		this[bdx.builtInCommands.AddZValue]=readCommand.bind(this, bdx.commandParams["AddZValue"]);
		this[bdx.builtInCommands.SubtractZValue]=readCommand.bind(this, bdx.commandParams["SubtractZValue"]);
		this[bdx.builtInCommands.AddInt16XValue]=readCommand.bind(this, bdx.commandParams["AddInt16XValue"]);
		this[bdx.builtInCommands.AddInt32XValue]=readCommand.bind(this, bdx.commandParams["AddInt32XValue"]);
		this[bdx.builtInCommands.AddInt16YValue]=readCommand.bind(this, bdx.commandParams["AddInt16YValue"]);
		this[bdx.builtInCommands.AddInt32YValue]=readCommand.bind(this, bdx.commandParams["AddInt32YValue"]);
		this[bdx.builtInCommands.AddInt16ZValue]=readCommand.bind(this, bdx.commandParams["AddInt16ZValue"]);
		this[bdx.builtInCommands.AddInt32ZValue]=readCommand.bind(this, bdx.commandParams["AddInt32ZValue"]);
		this[bdx.builtInCommands.SetCommandBlockData]=readCommand.bind(this, bdx.commandParams["SetCommandBlockData"]);
		this[bdx.builtInCommands.PlaceBlockWithCommandBlockData]=readCommand.bind(this, bdx.commandParams["PlaceBlockWithCommandBlockData"]);
		this[bdx.builtInCommands.AddInt8XValue]=readCommand.bind(this, bdx.commandParams["AddInt8XValue"]);
		this[bdx.builtInCommands.AddInt8YValue]=readCommand.bind(this, bdx.commandParams["AddInt8YValue"]);
		this[bdx.builtInCommands.AddInt8ZValue]=readCommand.bind(this, bdx.commandParams["AddInt8ZValue"]);
		this[bdx.builtInCommands.UseRuntimeIDPool]=readCommand.bind(this, bdx.commandParams["UseRuntimeIDPool"]);
		this[bdx.builtInCommands.PlaceRuntimeBlock]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlock"]);
		this[bdx.builtInCommands.PlaceRuntimeBlockWithUint32RuntimeID]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlockWithUint32RuntimeID"]);
		this[bdx.builtInCommands.PlaceRuntimeBlockWithCommandBlockData]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlockWithCommandBlockData"]);
		this[bdx.builtInCommands.PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID"]);
		this[bdx.builtInCommands.PlaceCommandBlockWithCommandBlockData]=readCommand.bind(this, bdx.commandParams["PlaceCommandBlockWithCommandBlockData"]);
		this[bdx.builtInCommands.PlaceRuntimeBlockWithChestData]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlockWithChestData"]);
		this[bdx.builtInCommands.PlaceRuntimeBlockWithChestDataAndUint32RuntimeID]=readCommand.bind(this, bdx.commandParams["PlaceRuntimeBlockWithChestDataAndUint32RuntimeID"]);
		this[bdx.builtInCommands.AssignDebugData]=function (){
			let object={};
			object.length=this.DataView.getUint32(this.offset);
			this.offset+=4;
			object.buffer=this.DataView.getBuffered(this.offset, object.length);
			this.offset+=length;
			return object;
		}
		this[bdx.builtInCommands.PlaceBlockWithChestData]=readCommand.bind(this, bdx.commandParams["PlaceBlockWithChestData"]);
		this[bdx.builtInCommands.PlaceBlockWithNBTData]=readCommand.bind(this, bdx.commandParams["PlaceBlockWithNBTData"]);
		this[bdx.builtInCommands.End]=readCommand.bind(this, bdx.commandParams["End"]);
		this[bdx.builtInCommands.Terminate]=readCommand.bind(this, bdx.commandParams["Terminate"]);
		this[bdx.builtInCommands.isSigned]=function (){
			if(this.DataView.getUint8(this.DataView.byteLength-1)!=90) return false;
			let signatureSize=this.DataView.getUint8(this.DataView.byteLength-2);
			return this.DataView.getBuffered(this.DataView.byteLength-2-signatureSize, signatureSize);
		}
		this.prefixCheck=function (){
			if(this.DataView.getUint32(this.offset)!=0x42445800) throw new Error("BDX Header prefix not found.");
			this.offset+=4;
		}
		
		this.JSONify=function (){
			this.offset=0;
			this.prefixCheck();
			let author=this.DataView.getString(this.offset);
			this.offset+=new TextEncoder().encode(author).byteLength+1;
			let commands=[];
			let command,commandName;
			while(this.offset<this.DataView.byteLength){
				command=this.DataView.getUint8(this.offset++);
				commandName=bdx.commandNames[command]
				if(!commandName){
					console.log('Unknown command: '+command);
					break;
				}
				let object={};
				object[commandName]=this[command]()
				commands.push(object)
				if(command==88) break;
			}
			this.offset=0;
			return {
				author: author,
				commands: commands,
				signed: this[bdx.builtInCommands.isSigned]()
			}
		}
		
		this.Matrixify=function (){
			this.offset=0;
			matrix=new Matrix();
			let x=0,y=0,z=0, constantStrings=[];
			this.prefixCheck();
			this.offset+=new TextEncoder().encode(this.DataView.getString(this.offset)).byteLength+1;
			let command;
			while(this.offset<this.DataView.byteLength){
				command=this.DataView.getUint8(this.offset++);
				if(!bdx.commandNames[command]){
					console.log(`Unknown command: ${command} at offset ${this.offset-1}`);
					break;
				}
				let params=this[command]();
				switch (command){
					case 1:
					constantStrings.push(params.constantString);
					break;
					case 14:
						x++;
						break;
					case 15:
						x--;
						break;
					case 20:
					case 21:
					case 28:
						x+=params.value;
						break;
					case 16:
						y++;
						break;
					case 17:
						y--;
						break;
					case 22:
					case 23:
					case 29:
						y+=params.value;
						break;
					case 18:
						z++;
						break;
					case 19:
						z--;
						break;
					case 24:
					case 25:
					case 30:
					case 8:
					case 12:
						z+=params.value;
						break;
					case 5:
						matrix.setBlock(x,y,z,new Block(constantStrings[params.blockConstantStringID]+constantStrings[params.blockStatesConstantStringID]));
						break;
					case 7:
						matrix.setBlock(x,y,z,new Block(blockData2block(constantStrings[params.blockConstantStringID],params.blockData)));
						break;
					case 9:
					case 88:
					case 69:
						break;
					case 13:
						matrix.setBlock(x,y,z,new Block(constantStrings[params.blockConstantStringID]+params.blockStatesString));
						break;
					case 26:
						matrix.modifyBlock(x,y,z,{blockEntityData: {"type":"compound","value":{"block_entity_data":{"type":"compound","value":{"Version":{"type": "int","value": 19},"id":{"type":"string","value":"CommandBlock"},"Command":{"type":"string","value":params.command},"CustomName":{"type":"string","value":params.customName},"TickDelay":{"type":"int","value":params.tickdelay},"TrackOutput":{"type":"byte","value":1},"auto":{"type":"byte","value":!params.needsRedstone},"conditionalMode": {"type": "byte","value": params.conditional}}}}}});
						break;
					case 27:
						matrix.setBlock(x,y,z,new Block(blockData2block(constantStrings[params.blockConstantStringID],params.blockData),{"type":"compound","value":{"block_entity_data":{"type":"compound","value":{"Version":{"type": "int","value": 19},"id":{"type":"string","value":"CommandBlock"},"Command":{"type":"string","value":params.command},"CustomName":{"type":"string","value":params.customName},"TickDelay":{"type":"int","value":params.tickdelay},"TrackOutput":{"type":"byte","value":1},"auto":{"type":"byte","value":!params.needsRedstone},"conditionalMode": {"type": "byte","value": params.conditional}}}}}));
						break;
					case 36:
						matrix.setBlock(x,y,z,new Block(blockData2block(`${params.mode?(params.mode==2?"chain_":"repeating_"):''}command_block`,params.data),{"type":"compound","value":{"block_entity_data":{"type":"compound","value":{"Version":{"type": "int","value": 19},"id":{"type":"string","value":"CommandBlock"},"Command":{"type":"string","value":params.command},"CustomName":{"type":"string","value":params.customName},"TickDelay":{"type":"int","value":params.tickdelay},"TrackOutput":{"type":"byte","value":1},"auto":{"type":"byte","value":!params.needsRedstone},"conditionalMode": {"type": "byte","value": params.conditional}}}}}));
						break;
					case 41:
						matrix.setBlock(x,y,z,new Block(constantStrings[params.blockConstantStringID]+constantStrings[params.blockStatesConstantStringID],{"type":"compound","value":{"block_entity_data":params.buffer['']}}))
						break;
					case 39:
						this.offset+=this.DataView.getUint32(this.offset)+4;
						break;
					default:
						console.log(`Unsupported or unknown command : ${command}-${bdx.commandNames[command]}`);
						break;
				}
				if(command==88) break;
			}
			this.offset=0;
			return matrix;
		}
		return this;
	};
	this.Writer=function (value){
		this.offset=0;
		/* Will be resized (x2) on write if necessary. */
		var buffer = new ArrayBuffer(4096);

		/* These are recreated when the buffer is */
		this.DataView = new DataView(buffer);
		var arrayView = new Uint8Array(buffer);
		// Ensures that the buffer is large enough to write `size` bytes
		// at the current `self.offset`.
		var self=this;
		function accommodate(size) {
			var requiredLength = self.offset + size;
			if (buffer.byteLength >= requiredLength) {
				return;
			}

			var newLength = buffer.byteLength;
			while (newLength < requiredLength) {
				newLength += 4096;
			}

			var newBuffer = new ArrayBuffer(newLength);
			var newArrayView = new Uint8Array(newBuffer);
			newArrayView.set(arrayView);

			// If there's a gap between the end of the old buffer
			// and the start of the new one, we need to zero it out
			if (self.offset > buffer.byteLength) {
				newArrayView.fill(0, buffer.byteLength, self.offset);
			}

			buffer = newBuffer;
			self.DataView = new DataView(newBuffer);
			arrayView = newArrayView;
		}
		
		this.getData = function() {
			accommodate(0);  /* make sure the offset is inside the buffer */
			return buffer.slice(0, self.offset);
		};
		
		function write(commandName){
			let argIndex=1,params;
			if(!bdx.builtInCommands[commandName]) throw new Error("Unknown command "+commandName);
			if (Object.values(params=bdx.commandParams[commandName]).length>arguments.length-1) throw new Error("Insufficient arguments. Required "+JSON.stringify(bdx.commandParams[commandName]));
			accommodate(1);
			this.DataView.setUint8(this.offset++, bdx.builtInCommands[commandName]);
			for(let i in params){
				accommodate(this.DataView.size[params[i]]);
				if(params[i]=='String') accommodate(new TextEncoder().encode(arguments[argIndex]).byteLength+1);
				if(params[i]=='NBTUncompressed') accommodate((arguments[argIndex].byteLength)||arguments[argIndex][''].size);
				if(params[i]=='ChestData') accommodate(arguments[argIndex].totLength);
				this.DataView['set'+params[i]](this.offset, arguments[argIndex]);
				this.offset+=this.DataView.size[params[i]];
				if(params[i]=='String') this.offset+=new TextEncoder().encode(arguments[argIndex]).byteLength+1;
				if(params[i]=='NBTUncompressed') this.offset+=(arguments[argIndex].byteLength-1)||arguments[argIndex][''].size;
				if(params[i]=='ChestData') this.offset+=arguments[argIndex].totLength;
				argIndex++;
			}
		}
		
		this.CreateConstantString = write.bind(this, 'CreateConstantString');
		this.PlaceBlockWithBlockStates = write.bind(this, 'PlaceBlockWithBlockStates');
		this.AddInt16ZValue0 = write.bind(this, 'AddInt16ZValue0');
		this.PlaceBlock = write.bind(this, 'PlaceBlock');
		this.AddZValue0 = write.bind(this, 'AddZValue0');
		this.NoOperation = write.bind(this, 'NoOperation');
		this.AddInt32ZValue0 = write.bind(this, 'AddInt32ZValue0');
		this.PlaceBlockWithBlockStatesDeprecated = write.bind(this, 'PlaceBlockWithBlockStatesDeprecated');
		this.AddXValue = write.bind(this, 'AddXValue');
		this.SubtractXValue = write.bind(this, 'SubtractXValue');
		this.AddYValue = write.bind(this, 'AddYValue');
		this.SubtractYValue = write.bind(this, 'SubtractYValue');
		this.AddZValue = write.bind(this, 'AddZValue');
		this.SubtractZValue = write.bind(this, 'SubtractZValue');
		this.AddInt16XValue = write.bind(this, 'AddInt16XValue');
		this.AddInt32XValue = write.bind(this, 'AddInt32XValue');
		this.AddInt16YValue = write.bind(this, 'AddInt16YValue');
		this.AddInt32YValue = write.bind(this, 'AddInt32YValue');
		this.AddInt16ZValue = write.bind(this, 'AddInt16ZValue');
		this.AddInt32ZValue = write.bind(this, 'AddInt32ZValue');
		this.SetCommandBlockData = write.bind(this, 'SetCommandBlockData');
		this.PlaceBlockWithCommandBlockData = write.bind(this, 'PlaceBlockWithCommandBlockData');
		this.AddInt8XValue = write.bind(this, 'AddInt8XValue');
		this.AddInt8YValue = write.bind(this, 'AddInt8YValue');
		this.AddInt8ZValue = write.bind(this, 'AddInt8ZValue');
		this.UseRuntimeIDPool = write.bind(this, 'UseRuntimeIDPool');
		this.PlaceRuntimeBlock = write.bind(this, 'PlaceRuntimeBlock');
		this.PlaceRuntimeBlockWithUint32RuntimeID = write.bind(this, 'PlaceRuntimeBlockWithUint32RuntimeID');
		this.PlaceRuntimeBlockWithCommandBlockData = write.bind(this, 'PlaceRuntimeBlockWithCommandBlockData');
		this.PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID = write.bind(this, 'PlaceRuntimeBlockWithCommandBlockDataAndUint32RuntimeID');
		this.PlaceCommandBlockWithCommandBlockData = write.bind(this, 'PlaceCommandBlockWithCommandBlockData');
		this.PlaceRuntimeBlockWithChestData = write.bind(this, 'PlaceRuntimeBlockWithChestData');
		this.PlaceRuntimeBlockWithChestDataAndUint32RuntimeID = write.bind(this, 'PlaceRuntimeBlockWithChestDataAndUint32RuntimeID');
		this.AssignDebugData = function (value){
			if(!value) throw new Error("Debug data is falsy!");
			let buffer;
			if(value.type=='ArrayBuffer'){
				buffer=new Uint8Array(value.value).buffer;
			}else{
				buffer=value;
			}
			this.DataView.setUint8(this.offset++, bdx.builtInCommands.AssignDebugData);
			this.DataView.setUint32(this.offset, buffer.byteLength);
			this.offset+=4;
			this.DataView.setBuffered(this.offset, buffer);
			this.offset+=buffer.byteLength;
		}
		this.PlaceBlockWithChestData = write.bind(this, 'PlaceBlockWithChestData');
		this.PlaceBlockWithNBTData = write.bind(this, 'PlaceBlockWithNBTData');
		this.End = write.bind(this, 'End');
		this.Terminate = write.bind(this, 'Terminate');
		this.isSigned = write.bind(this, 'isSigned');
		this.setHeader=function (author){
			this.offset=0;
			this.DataView.setUint32(this.offset, 0x42445800);
			this.offset+=4;
			this.offset+=this.DataView.setString(this.offset, author);
		}
		this.fromJSON=function (JSONified){
			this.setHeader(JSONified.author);
			//this.offset+=new TextEncoder().encode(JSONified.author).byteLength+1;
			for(let i of JSONified.commands){
				for(let j in i){
					this[j].apply(this, Object.values(i[j]));
				}
			}
			return this.getData();
		}
		this.fromMatrix=function (matrix, author=''){
			this.setHeader(author);
			let x=0,y=0,z=0,constantStrings=[],constantStringID=[];
			for(let i in matrix.palette){
				let block=matrix.palette[i].match(/([a-zA-Z_:]+)(\[.+\])?/);
				constantStringID[i]=[];
				if(constantStrings.includes(block[1])){
					constantStringID[i][0]=constantStrings.indexOf(block[1]);
				}else{
					constantStringID[i][0]=constantStrings.push(block[1])-1;
					this.CreateConstantString(block[1]);
				}
				if(constantStrings.includes(block[2])){
					constantStringID[i][1]=constantStrings.indexOf(block[2]);
				}else{
					constantStringID[i][1]=constantStrings.push(block[2])-1;
					this.CreateConstantString(block[2]);
				}
			}
			for(let i of matrix.getAllBlocks()){
				if(i.x-x){
					this.AddInt16XValue(i.x-x);
				}
				if(i.y-y){
					this.AddInt16YValue(i.y-y);
				}
				if(i.z-z){
					this.AddInt16ZValue(i.z-z);
				}
				x=i.x,y=i.y,z=i.z;
				if(i.block.blockEntityData){
					let writer=new nbt.Writer(true);
					writer.compound({'':i.block.blockEntityData.value.block_entity_data});
					let nbtData=writer.getData();
					this.PlaceBlockWithNBTData(constantStringID[i.block.Index][0],constantStringID[i.block.Index][1],constantStringID[i.block.Index][1],nbtData);
				}else{
					this.PlaceBlockWithBlockStates(constantStringID[i.block.Index][0],constantStringID[i.block.Index][1]);
				}
			}
			this.Terminate();
			this.End();
			return this.getData();
		}
	}
}).apply(typeof exports !== 'undefined' ? exports : (window.bdx = {}));