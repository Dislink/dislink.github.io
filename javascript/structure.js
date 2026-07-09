var MCStructure=(function (structure){
	var that=this;
	if(structure){
		this.structure=structure;
	}else{
		this.structure={"name":"","value":{"format_version":{"type":"int","value":1},"size":{"type":"list","value":{"type":"int","value":[0,0,0]}},"structure":{"type":"compound","value":{"block_indices":{"type":"list","value":{"type":"intArray","value":[new Int32Array(0),new Int32Array(0)]}},"entities":{"type":"list","value":{"type":"end","value":[]}},"palette":{"type":"compound","value":{"default":{"type":"compound","value":{"block_palette":{"type":"list","value":{"type":"compound","value":[]}},"block_position_data":{"type":"compound","value":{}}}}}}}},"structure_world_origin":{"type":"list","value":{"type":"int","value":[0,0,0]}}}};
	}
	this.fromMatrix=function (matrix){
		that.structure={"name":"","value":{"format_version":{"type":"int","value":1},"size":{"type":"list","value":{"type":"int","value":[0,0,0]}},"structure":{"type":"compound","value":{"block_indices":{"type":"list","value":{"type":"intArray","value":[new Int32Array(0),new Int32Array(0)]}},"entities":{"type":"list","value":{"type":"end","value":[]}},"palette":{"type":"compound","value":{"default":{"type":"compound","value":{"block_palette":{"type":"list","value":{"type":"compound","value":[]}},"block_position_data":{"type":"compound","value":{}}}}}}}},"structure_world_origin":{"type":"list","value":{"type":"int","value":[0,0,0]}}}};
		//fix size
		that.structure.value.size.value.value=[matrix.Xmax,matrix.Ymax,matrix.Zmax];
		that.structure.value.structure.value.block_indices.value.value[0]=new Int32Array(matrix.Xmax*matrix.Ymax*matrix.Zmax).fill(-1);
		that.structure.value.structure.value.block_indices.value.value[1]=new Int32Array(matrix.Xmax*matrix.Ymax*matrix.Zmax).fill(-1);
		//fix palette
		for(let i of matrix.palette){
			let block=i.match(/([a-zA-Z0-9_:]+)\s*(?:\[(.+)\])?(?:\@(\d+))?/);
			let paletteItem={"name":{"type":"string","value":block[1]}};
			if(block[2]) paletteItem.states=blockStatesString2blockStates(block[2]);
			if(block[3]!==undefined) paletteItem.version={"type":"int","value":+block[3]};
			that.structure.value.structure.value.palette.value.default.value.block_palette.value.value.push(paletteItem);
		}
		//fix blocks
		for(let i of matrix.getAllBlocks()){
			that.structure.value.structure.value.block_indices.value.value[0][((i.x+matrix.xOffset)*matrix.Ymax*matrix.Zmax)+((i.y+matrix.yOffset)*matrix.Zmax)+parseInt(i.z)+matrix.zOffset]=i.block.Index;
			if(i.block.blockEntityData) that.structure.value.structure.value.palette.value.default.value.block_position_data.value[((i.x+matrix.xOffset)*matrix.Ymax*matrix.Zmax)+((i.y+matrix.yOffset)*matrix.Zmax)+parseInt(i.z)+matrix.zOffset]=i.block.blockEntityData;
		}
		return that.structure;
	}
	this.Matrixify=function (){
		let matrix=new Matrix();
		for(let i of that.structure.value.structure.value.palette.value.default.value.block_palette.value.value){
			console.log(i);
			matrix.palette.push(`${i.name.value}`+(i.states?blockStates2blockStatesString(i.states.value):'')+((i.version)?`@${i.version.value}`:''));
		}
		let x=0,y=0,z=0;
		for(let i in that.structure.value.structure.value.block_indices.value.value[0]){
			if(that.structure.value.structure.value.block_indices.value.value[0][i]!==-1){
				matrix.setBlock(x,y,z,new IndexedBlock(that.structure.value.structure.value.block_indices.value.value[0][i],that.structure.value.structure.value.palette.value.default.value.block_position_data.value[i]));
			}
			if(z==that.structure.value.size.value.value[2]-1){
				z=0;
				if(y==that.structure.value.size.value.value[1]-1){
					y=0;x++;
				}else{
					y++;
				}
			}else{
				z++;
			}
		}
		return matrix;
	}
})
typeof module !== 'undefined'?module.exports=MCStructure:(typeof globalThis !== 'undefined' ? globalThis : global || self).MCStructure=MCStructure;