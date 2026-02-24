houselenght = 8;
housewidth = 5;
househight = 3;
wallthickness = 0.2;
windowwidth = 0.9;
windowhight = 1.2;
window_y = 1;
windowcount = round(houselenght/(windowwidth*2.9));
windowindent = (houselenght-windowcount*windowwidth)/(windowcount+1);
basementhight = 0.8;
basementwidth = 0.1;
doorwidght = 1;
doorhight = 2.2;
roofhight = 2;

//basement
translate ([-basementwidth, -basementwidth, 0]){
    cube([houselenght+basementwidth*2, housewidth+basementwidth*2, basementhight]);
}
    
//left wall
difference() {
    translate([0, 0, basementhight]) {
        cube([houselenght, wallthickness, househight]);
    }
    if (windowcount>0)
        for (i = [0:windowcount-1])
            translate([windowindent+windowwidth*i+windowindent*i, -wallthickness, basementhight+window_y]) {
                cube([windowwidth, basementhight+window_y, windowhight]);
            } 
}
        
//right wall        
difference() {
    translate([0, housewidth-wallthickness, basementhight]) {
        cube([houselenght, wallthickness, househight]);
    }
    if (windowcount>0)
        for (i = [0:windowcount-1])
            translate([windowindent+windowwidth*i+windowindent*i, housewidth-wallthickness*2, basementhight+window_y]) {
                cube([windowwidth, 1, windowhight]);
            } 
}
        
//back wall        
difference() {
    translate([0, wallthickness, basementhight]) {
        cube([wallthickness, housewidth-wallthickness*2, househight]);
    }
    translate([-wallthickness, housewidth/2-windowwidth/2, basementhight+window_y]) {
        cube([1, windowwidth, windowhight]);
    } 
}        
        
//front wall
difference() {
    translate([houselenght-wallthickness, wallthickness, basementhight]) {
        cube([wallthickness, housewidth-wallthickness*2, househight]);
    }
    if (housewidth > 4) {
        translate ([houselenght-wallthickness*2, windowindent-windowwidth, basementhight+window_y]) {
            cube([1, windowwidth, windowhight]);
        }    
        translate ([houselenght-wallthickness*2, housewidth-windowindent, basementhight+window_y]) {
            cube([1, windowwidth, windowhight]);
        }    
        translate([houselenght-wallthickness*2, housewidth/2-windowwidth/2, basementhight-0.1]) {
        cube([1, doorwidght, doorhight+0.1]);        
        }
    } 
}    

//roof
translate ([0,0,basementhight+househight]) {
    rotate([90,0,90]) {
        linear_extrude(houselenght) {
            polygon(points=[[0,0],[housewidth, 0],[housewidth/2, roofhight]]);
        }    
    }
}      